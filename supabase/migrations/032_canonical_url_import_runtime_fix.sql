-- DealFlowIQ 032 — Canonical URL import runtime fix.
-- Purpose:
-- 1) Make /imports the only canonical URL import flow.
-- 2) Allow InvestorLift as a real provider with 40 listings/hour.
-- 3) Keep imports from failing on older market_listings schemas by storing extra metadata in raw_payload.
-- Safe/idempotent. Run after existing DealFlowIQ market/import migrations.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'market_listings'
      AND constraint_name = 'market_listings_source_type_check'
  ) THEN
    ALTER TABLE public.market_listings DROP CONSTRAINT market_listings_source_type_check;
  END IF;

  ALTER TABLE public.market_listings
    ADD CONSTRAINT market_listings_source_type_check
    CHECK (source_type IN (
      'manual', 'manual_url', 'generic',
      'zillow', 'crexi', 'loopnet', 'redfin', 'realtor', 'apartments', 'investorlift',
      'csv', 'partner_api', 'mls_feed', 'public_deal', 'community_deal', 'other'
    ));
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'market_sources'
      AND constraint_name = 'market_sources_source_type_check'
  ) THEN
    ALTER TABLE public.market_sources DROP CONSTRAINT market_sources_source_type_check;
  END IF;

  ALTER TABLE public.market_sources
    ADD CONSTRAINT market_sources_source_type_check
    CHECK (source_type IN (
      'manual', 'manual_url', 'generic',
      'zillow', 'crexi', 'loopnet', 'redfin', 'realtor', 'apartments', 'investorlift',
      'csv', 'partner_api', 'mls_feed', 'other'
    ));
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'market_url_import_batches'
      AND constraint_name = 'market_url_import_batches_source_type_check'
  ) THEN
    ALTER TABLE public.market_url_import_batches DROP CONSTRAINT market_url_import_batches_source_type_check;
  END IF;

  IF to_regclass('public.market_url_import_batches') IS NOT NULL THEN
    ALTER TABLE public.market_url_import_batches
      ADD CONSTRAINT market_url_import_batches_source_type_check
      CHECK (source_type IN (
        'manual', 'manual_url', 'generic',
        'zillow', 'crexi', 'loopnet', 'redfin', 'realtor', 'apartments', 'investorlift',
        'csv', 'partner_api', 'mls_feed', 'public_deal', 'community_deal', 'other'
      ));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'market_provider_policies'
      AND constraint_name = 'market_provider_policies_source_type_check'
  ) THEN
    ALTER TABLE public.market_provider_policies DROP CONSTRAINT market_provider_policies_source_type_check;
  END IF;

  IF to_regclass('public.market_provider_policies') IS NOT NULL THEN
    ALTER TABLE public.market_provider_policies
      ADD CONSTRAINT market_provider_policies_source_type_check
      CHECK (source_type IN ('zillow','redfin','realtor','crexi','loopnet','apartments','investorlift','generic','manual_url','other'));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'market_provider_import_events'
      AND constraint_name = 'market_provider_import_events_source_type_check'
  ) THEN
    ALTER TABLE public.market_provider_import_events DROP CONSTRAINT market_provider_import_events_source_type_check;

    ALTER TABLE public.market_provider_import_events
      ADD CONSTRAINT market_provider_import_events_source_type_check
      CHECK (source_type IN (
        'zillow', 'crexi', 'loopnet', 'redfin', 'realtor', 'apartments', 'investorlift',
        'csv', 'partner_api', 'mls_feed', 'manual', 'manual_url', 'generic', 'other'
      ));
  END IF;
END $$;

INSERT INTO public.market_provider_policies (
  organization_id,
  source_type,
  provider_label,
  is_active,
  max_listings_per_hour,
  max_listings_per_day,
  storage_days,
  images_allowed,
  description_allowed,
  source_link_required,
  attribution_required,
  search_import_allowed,
  listing_import_allowed,
  provider_notes
)
VALUES
  (NULL, 'investorlift', 'InvestorLift', true, 40, NULL, 15, true, true, true, true, true, true, 'Authorized live import under approved 40 listings/hour policy. No proxy rotation, CAPTCHA bypass, or anti-bot circumvention.')
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

COMMENT ON TABLE public.market_provider_policies IS 'Provider permissions and rate limits. InvestorLift is supported as live provider with 40 listings/hour. Imports must never use demo data or anti-bot bypass.';
