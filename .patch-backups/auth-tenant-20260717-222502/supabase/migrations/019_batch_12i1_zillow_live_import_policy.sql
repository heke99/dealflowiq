-- DealFlowIQ Batch 12I.1 — Authorized Zillow live search/listing import policy.
-- Run after 018_batch_12i_import_queue_notifications_review.sql.

create extension if not exists pgcrypto;

-- 1) Provider retention and compliance metadata on normalized listings.
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS source_data_expires_at timestamptz;
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS source_terms_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_market_listings_source_data_expires
ON public.market_listings(organization_id, source_type, source_data_expires_at)
WHERE source_data_expires_at IS NOT NULL;

COMMENT ON COLUMN public.market_listings.source_data_expires_at IS 'Provider retention expiry for copied source data/images. Zillow authorized URL imports are currently retained for 15 days.';
COMMENT ON COLUMN public.market_listings.source_terms_metadata IS 'Provider-specific import policy metadata: allowed storage window, rate limit, attribution/source-link rules and import mode.';

-- 2) Rolling import-event log used for provider rate limits and audit trail.
CREATE TABLE IF NOT EXISTS public.market_provider_import_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source_type text NOT NULL,
  provider_name text NOT NULL,
  event_type text NOT NULL DEFAULT 'listing_imported',
  source_url text,
  listing_id uuid REFERENCES public.market_listings(id) ON DELETE SET NULL,
  import_job_id uuid REFERENCES public.market_import_jobs(id) ON DELETE SET NULL,
  import_batch_id uuid REFERENCES public.market_url_import_batches(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT market_provider_import_events_source_type_check CHECK (source_type IN ('zillow', 'crexi', 'loopnet', 'redfin', 'realtor', 'apartments', 'csv', 'partner_api', 'mls_feed', 'manual', 'manual_url', 'other')),
  CONSTRAINT market_provider_import_events_event_type_check CHECK (event_type IN ('search_page_read', 'listing_imported', 'listing_skipped', 'import_failed'))
);

ALTER TABLE public.market_provider_import_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_provider_import_events_select_org ON public.market_provider_import_events;
CREATE POLICY market_provider_import_events_select_org ON public.market_provider_import_events
FOR SELECT TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS market_provider_import_events_insert_org ON public.market_provider_import_events;
CREATE POLICY market_provider_import_events_insert_org ON public.market_provider_import_events
FOR INSERT TO authenticated
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

CREATE INDEX IF NOT EXISTS idx_market_provider_import_events_rate_limit
ON public.market_provider_import_events(organization_id, source_type, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_provider_import_events_batch
ON public.market_provider_import_events(import_batch_id, created_at DESC);

COMMENT ON TABLE public.market_provider_import_events IS 'Auditable provider import events. Used to enforce authorized provider limits such as Zillow max 10 listing detail imports per rolling hour.';

-- 3) Batch counters for direct live imports from analyzed URL batches.
ALTER TABLE public.market_url_import_batches ADD COLUMN IF NOT EXISTS import_limit_per_hour integer;
ALTER TABLE public.market_url_import_batches ADD COLUMN IF NOT EXISTS allowed_storage_days integer;
ALTER TABLE public.market_url_import_batches ADD COLUMN IF NOT EXISTS listings_discovered integer NOT NULL DEFAULT 0;
ALTER TABLE public.market_url_import_batches ADD COLUMN IF NOT EXISTS listings_imported integer NOT NULL DEFAULT 0;
ALTER TABLE public.market_url_import_batches ADD COLUMN IF NOT EXISTS listings_updated integer NOT NULL DEFAULT 0;
ALTER TABLE public.market_url_import_batches ADD COLUMN IF NOT EXISTS listings_failed integer NOT NULL DEFAULT 0;
ALTER TABLE public.market_url_import_batches ADD COLUMN IF NOT EXISTS imported_listing_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.market_url_import_batches ADD COLUMN IF NOT EXISTS provider_policy jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.market_url_import_batches.provider_policy IS 'Policy snapshot used when the import batch ran: source, rate limit, retention days and source-link rules.';

-- 4) Retention helper. Run from SQL or future cron. It keeps the deal row/audit history but removes copied provider content once expired.
CREATE OR REPLACE FUNCTION public.cleanup_expired_market_source_data()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer := 0;
BEGIN
  UPDATE public.market_listings
  SET
    description = CASE WHEN source_type = 'zillow' THEN NULL ELSE description END,
    primary_image_url = CASE WHEN source_type = 'zillow' THEN NULL ELSE primary_image_url END,
    image_urls = CASE WHEN source_type = 'zillow' THEN '[]'::jsonb ELSE image_urls END,
    raw_payload = COALESCE(raw_payload, '{}'::jsonb) || jsonb_build_object(
      'sourceDataExpiredAt', now(),
      'retentionCleanup', 'Copied provider description/images/raw payload trimmed after source retention window.'
    ),
    source_terms_metadata = COALESCE(source_terms_metadata, '{}'::jsonb) || jsonb_build_object('retentionCleanedAt', now()),
    updated_at = now()
  WHERE source_data_expires_at IS NOT NULL
    AND source_data_expires_at <= now()
    AND COALESCE((source_terms_metadata->>'retentionCleanedAt'), '') = '';

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

COMMENT ON FUNCTION public.cleanup_expired_market_source_data() IS 'Clears copied provider data/images after the permitted retention window while preserving DealFlowIQ analysis, source link, scores and audit trail.';
