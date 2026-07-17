-- DealFlowIQ Batch 12I.2 — Multi-provider import, rent intelligence and import controls.
-- This version intentionally does NOT include demo import mode.
-- Run after 018_batch_12i_import_queue_notifications_review.sql.

create extension if not exists pgcrypto;

-- Provider policies are configurable per organization/provider. No provider is hardcoded beyond seeded defaults.
CREATE TABLE IF NOT EXISTS public.market_provider_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  provider_label text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  max_listings_per_hour integer NOT NULL DEFAULT 0,
  max_listings_per_day integer,
  storage_days integer NOT NULL DEFAULT 15,
  images_allowed boolean NOT NULL DEFAULT false,
  description_allowed boolean NOT NULL DEFAULT false,
  source_link_required boolean NOT NULL DEFAULT true,
  attribution_required boolean NOT NULL DEFAULT true,
  search_import_allowed boolean NOT NULL DEFAULT false,
  listing_import_allowed boolean NOT NULL DEFAULT false,
  provider_notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT market_provider_policies_source_type_check CHECK (source_type IN ('zillow','redfin','realtor','crexi','loopnet','generic','manual_url','other')),
  CONSTRAINT market_provider_policies_storage_days_check CHECK (storage_days >= 1 AND storage_days <= 365),
  CONSTRAINT market_provider_policies_hourly_check CHECK (max_listings_per_hour >= 0 AND max_listings_per_hour <= 500)
);

DROP TRIGGER IF EXISTS set_market_provider_policies_updated_at ON public.market_provider_policies;
CREATE TRIGGER set_market_provider_policies_updated_at
BEFORE UPDATE ON public.market_provider_policies
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS idx_market_provider_policies_org_source ON public.market_provider_policies(coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), source_type);
CREATE INDEX IF NOT EXISTS idx_market_provider_policies_org_active ON public.market_provider_policies(organization_id, is_active, source_type);

ALTER TABLE public.market_provider_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS market_provider_policies_select_org ON public.market_provider_policies;
CREATE POLICY market_provider_policies_select_org ON public.market_provider_policies
FOR SELECT TO authenticated
USING (organization_id IS NULL OR public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());
DROP POLICY IF EXISTS market_provider_policies_write_org ON public.market_provider_policies;
CREATE POLICY market_provider_policies_write_org ON public.market_provider_policies
FOR ALL TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

INSERT INTO public.market_provider_policies (organization_id, source_type, provider_label, is_active, max_listings_per_hour, max_listings_per_day, storage_days, images_allowed, description_allowed, source_link_required, attribution_required, search_import_allowed, listing_import_allowed, provider_notes)
VALUES
  (NULL, 'zillow', 'Zillow', true, 10, NULL, 15, true, true, true, true, true, true, 'Authorized live import only. No proxy rotation, CAPTCHA bypass, or anti-bot circumvention.'),
  (NULL, 'redfin', 'Redfin', true, 10, NULL, 15, true, true, true, true, true, true, 'Authorized live import under same documented provider policy as Zillow. No proxy rotation, CAPTCHA bypass, or anti-bot circumvention.'),
  (NULL, 'realtor', 'Realtor.com', true, 10, NULL, 15, true, true, true, true, true, true, 'Authorized live import under same documented provider policy as Zillow. No proxy rotation, CAPTCHA bypass, or anti-bot circumvention.'),
  (NULL, 'crexi', 'Crexi', true, 10, NULL, 15, true, true, true, true, true, true, 'Authorized commercial live import under same documented provider policy as Zillow. No proxy rotation, CAPTCHA bypass, or anti-bot circumvention.'),
  (NULL, 'loopnet', 'LoopNet', true, 10, NULL, 15, true, true, true, true, true, true, 'Authorized commercial live import under same documented provider policy as Zillow. No proxy rotation, CAPTCHA bypass, or anti-bot circumvention.'),
  (NULL, 'generic', 'Generic authorized URL', false, 0, NULL, 15, false, false, true, true, false, false, 'Fallback adapter. Keep inactive unless permission and rate limits are documented.')
ON CONFLICT (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), source_type)
DO UPDATE SET
  provider_label = EXCLUDED.provider_label,
  is_active = EXCLUDED.is_active,
  max_listings_per_hour = EXCLUDED.max_listings_per_hour,
  max_listings_per_day = EXCLUDED.max_listings_per_day,
  storage_days = EXCLUDED.storage_days,
  images_allowed = EXCLUDED.images_allowed,
  description_allowed = EXCLUDED.description_allowed,
  source_link_required = EXCLUDED.source_link_required,
  attribution_required = EXCLUDED.attribution_required,
  search_import_allowed = EXCLUDED.search_import_allowed,
  listing_import_allowed = EXCLUDED.listing_import_allowed,
  provider_notes = EXCLUDED.provider_notes,
  updated_at = now();

-- Batch/import controls.
ALTER TABLE public.market_url_import_batches ADD COLUMN IF NOT EXISTS policy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.market_url_import_batches ADD COLUMN IF NOT EXISTS total_found integer NOT NULL DEFAULT 0;
ALTER TABLE public.market_url_import_batches ADD COLUMN IF NOT EXISTS imported_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.market_url_import_batches ADD COLUMN IF NOT EXISTS skipped_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.market_url_import_batches ADD COLUMN IF NOT EXISTS failed_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.market_url_import_batches ADD COLUMN IF NOT EXISTS duplicate_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.market_url_import_batches ADD COLUMN IF NOT EXISTS next_allowed_import_at timestamptz;
ALTER TABLE public.market_url_import_batches ADD COLUMN IF NOT EXISTS provider_data_expires_at timestamptz;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='public' AND table_name='market_url_import_batches' AND constraint_name='market_url_import_batches_status_check') THEN
    ALTER TABLE public.market_url_import_batches DROP CONSTRAINT market_url_import_batches_status_check;
  END IF;
  ALTER TABLE public.market_url_import_batches ADD CONSTRAINT market_url_import_batches_status_check CHECK (status IN ('draft','analyzed','ready','queued','preview_ready','running','importing','rate_limited','partially_imported','completed','needs_review','failed','cancelled','expired_provider_data'));
END $$;

CREATE TABLE IF NOT EXISTS public.market_import_preview_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  import_batch_id uuid NOT NULL REFERENCES public.market_url_import_batches(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_url text NOT NULL,
  external_listing_id text,
  title text,
  address text,
  city text,
  state text,
  zip_code text,
  price numeric(14,2),
  bedrooms numeric(6,2),
  bathrooms numeric(6,2),
  sqft integer,
  asset_class text NOT NULL DEFAULT 'unknown',
  property_type text,
  image_url text,
  normalized_listing jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'new',
  duplicate_listing_id uuid REFERENCES public.market_listings(id) ON DELETE SET NULL,
  ignored boolean NOT NULL DEFAULT false,
  ignore_reason text,
  data_quality jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  imported_listing_id uuid REFERENCES public.market_listings(id) ON DELETE SET NULL,
  imported_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT market_import_preview_items_status_check CHECK (status IN ('new','existing','duplicate','ignored','selected','imported','skipped','failed'))
);
CREATE INDEX IF NOT EXISTS idx_market_import_preview_items_batch ON public.market_import_preview_items(import_batch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_import_preview_items_org_status ON public.market_import_preview_items(organization_id, status, created_at DESC);
ALTER TABLE public.market_import_preview_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS market_import_preview_items_org ON public.market_import_preview_items;
CREATE POLICY market_import_preview_items_org ON public.market_import_preview_items
FOR ALL TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

CREATE TABLE IF NOT EXISTS public.market_import_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  import_batch_id uuid REFERENCES public.market_url_import_batches(id) ON DELETE CASCADE,
  listing_id uuid REFERENCES public.market_listings(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_market_import_audit_events_batch ON public.market_import_audit_events(import_batch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_import_audit_events_org_type ON public.market_import_audit_events(organization_id, event_type, created_at DESC);
ALTER TABLE public.market_import_audit_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS market_import_audit_events_org ON public.market_import_audit_events;
CREATE POLICY market_import_audit_events_org ON public.market_import_audit_events
FOR ALL TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

CREATE TABLE IF NOT EXISTS public.market_ignored_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_type text,
  source_url text,
  external_listing_id text,
  normalized_address text,
  zip_code text,
  reason text NOT NULL DEFAULT 'other',
  notes text,
  ignored_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ignored_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT market_ignored_listings_reason_check CHECK (reason IN ('bad_area','wrong_asset_type','duplicate','already_reviewed','unrealistic_price','not_investment_suitable','other'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_market_ignored_listings_org_url ON public.market_ignored_listings(organization_id, source_url) WHERE source_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_market_ignored_listings_org_address ON public.market_ignored_listings(organization_id, normalized_address, zip_code);
ALTER TABLE public.market_ignored_listings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS market_ignored_listings_org ON public.market_ignored_listings;
CREATE POLICY market_ignored_listings_org ON public.market_ignored_listings
FOR ALL TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

-- Rent intelligence tables.
CREATE TABLE IF NOT EXISTS public.listing_rent_estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES public.market_listings(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'auto_market_rent',
  estimated_rent numeric(14,2),
  rent_low numeric(14,2),
  rent_high numeric(14,2),
  confidence_score integer NOT NULL DEFAULT 0,
  confidence_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  missing_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_listing_rent_estimates_listing ON public.listing_rent_estimates(listing_id, created_at DESC);
ALTER TABLE public.listing_rent_estimates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS listing_rent_estimates_org ON public.listing_rent_estimates;
CREATE POLICY listing_rent_estimates_org ON public.listing_rent_estimates
FOR ALL TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

CREATE TABLE IF NOT EXISTS public.listing_hud_rent_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES public.market_listings(id) ON DELETE CASCADE,
  state text,
  county text,
  zip_code text,
  zip text,
  bedrooms integer,
  hud_year integer,
  area_name text,
  fmr_0br numeric(14,2),
  fmr_1br numeric(14,2),
  fmr_2br numeric(14,2),
  fmr_3br numeric(14,2),
  fmr_4br numeric(14,2),
  selected_fmr numeric(14,2),
  lookup_status text NOT NULL DEFAULT 'pending',
  confidence_score integer NOT NULL DEFAULT 0,
  source_url text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_listing_hud_rent_snapshots_listing ON public.listing_hud_rent_snapshots(listing_id, created_at DESC);
ALTER TABLE public.listing_hud_rent_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS listing_hud_rent_snapshots_org ON public.listing_hud_rent_snapshots;
CREATE POLICY listing_hud_rent_snapshots_org ON public.listing_hud_rent_snapshots
FOR ALL TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

CREATE TABLE IF NOT EXISTS public.listing_manual_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES public.market_listings(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  old_value text,
  new_value text NOT NULL,
  reason text NOT NULL,
  apply_to_score boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_listing_manual_overrides_listing ON public.listing_manual_overrides(listing_id, created_at DESC);
ALTER TABLE public.listing_manual_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS listing_manual_overrides_org ON public.listing_manual_overrides;
CREATE POLICY listing_manual_overrides_org ON public.listing_manual_overrides
FOR ALL TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

-- Listing columns for stage/retention/policy/quality.
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS deal_stage text NOT NULL DEFAULT 'imported';
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS provider_attribution text;
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS source_policy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS provider_data_expires_at timestamptz;
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS provider_data_expired_at timestamptz;
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS data_quality_checklist jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS confidence_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS rent_confidence_score integer;
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS rent_confidence_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS data_quality_missing_fields jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS source_data_expires_at timestamptz;
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS source_terms_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='public' AND table_name='market_listings' AND constraint_name='market_listings_deal_stage_check') THEN
    ALTER TABLE public.market_listings DROP CONSTRAINT market_listings_deal_stage_check;
  END IF;
  ALTER TABLE public.market_listings ADD CONSTRAINT market_listings_deal_stage_check CHECK (deal_stage IN ('imported','needs_review','analyzed','watchlist','opportunity','underwriting','offer_made','rejected','archived'));
END $$;
CREATE INDEX IF NOT EXISTS idx_market_listings_org_stage ON public.market_listings(organization_id, deal_stage, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_listings_provider_expiry ON public.market_listings(organization_id, provider_data_expires_at) WHERE provider_data_expired_at IS NULL;

-- Widen notification types for import/rent controls.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='public' AND table_name='notifications' AND constraint_name='notifications_type_check') THEN
    ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
  END IF;
  ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'system','import_analyzed','import_completed','import_failed','import_rate_limited','provider_data_expiring','provider_data_expired','cleanup_completed',
    'opportunity_found','buyer_match','saved_deal_score_changed','buy_box_run_completed','rent_confidence_review','rent_analysis_failed','hud_lookup_failed',
    'deal_note_added','deal_status_changed','duplicate_listing_detected','manual_override_changed'
  ));
END $$;

-- Retention cleanup keeps DealFlowIQ analysis but removes copied provider content.
DROP FUNCTION IF EXISTS public.cleanup_expired_market_source_data();
CREATE OR REPLACE FUNCTION public.cleanup_expired_market_source_data()
RETURNS TABLE(cleaned_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer := 0;
BEGIN
  UPDATE public.market_listings
  SET
    description = NULL,
    image_urls = '[]'::jsonb,
    primary_image_url = NULL,
    raw_payload = jsonb_build_object('provider_data_expired_at', now(), 'retained', 'source_url, DealFlowIQ analysis, scores, notes, matches and audit trail'),
    provider_data_expired_at = now(),
    updated_at = now()
  WHERE provider_data_expires_at IS NOT NULL
    AND provider_data_expires_at <= now()
    AND provider_data_expired_at IS NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN QUERY SELECT affected;
END;
$$;

COMMENT ON FUNCTION public.cleanup_expired_market_source_data() IS 'Removes copied provider content after provider retention period while retaining DealFlowIQ analysis, source link, scores, notes and audit trail.';
COMMENT ON TABLE public.market_import_preview_items IS 'Real provider import preview rows. No demo import mode is created in Batch 12I.2.';
COMMENT ON TABLE public.market_provider_policies IS 'Provider permissions and rate limits. No email/SMS and no demo import mode.';
