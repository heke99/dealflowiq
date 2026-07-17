-- DealFlowIQ Batch — InvestorLift live import provider.
-- Adds InvestorLift as a real provider, not demo mode, with a 40 listings/hour cap.
-- Run after 025_admin_subscription_plan_polish.sql.

create extension if not exists pgcrypto;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='public' AND table_name='market_listings' AND constraint_name='market_listings_source_type_check') THEN
    ALTER TABLE public.market_listings DROP CONSTRAINT market_listings_source_type_check;
  END IF;
  ALTER TABLE public.market_listings ADD CONSTRAINT market_listings_source_type_check
    CHECK (source_type IN ('manual', 'manual_url', 'zillow', 'investorlift', 'crexi', 'loopnet', 'redfin', 'realtor', 'apartments', 'csv', 'partner_api', 'mls_feed', 'public_deal', 'community_deal', 'other'));
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='public' AND table_name='market_sources' AND constraint_name='market_sources_source_type_check') THEN
    ALTER TABLE public.market_sources DROP CONSTRAINT market_sources_source_type_check;
  END IF;
  ALTER TABLE public.market_sources ADD CONSTRAINT market_sources_source_type_check
    CHECK (source_type IN ('zillow', 'investorlift', 'crexi', 'loopnet', 'redfin', 'realtor', 'apartments', 'csv', 'manual_url', 'partner_api', 'mls_feed', 'manual', 'other'));
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='public' AND table_name='market_url_import_batches' AND constraint_name='market_url_import_batches_source_type_check') THEN
    ALTER TABLE public.market_url_import_batches DROP CONSTRAINT market_url_import_batches_source_type_check;
  END IF;
  ALTER TABLE public.market_url_import_batches ADD CONSTRAINT market_url_import_batches_source_type_check
    CHECK (source_type IN ('manual', 'manual_url', 'zillow', 'investorlift', 'crexi', 'loopnet', 'redfin', 'realtor', 'apartments', 'csv', 'partner_api', 'mls_feed', 'public_deal', 'community_deal', 'other'));
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='public' AND table_name='market_provider_policies' AND constraint_name='market_provider_policies_source_type_check') THEN
    ALTER TABLE public.market_provider_policies DROP CONSTRAINT market_provider_policies_source_type_check;
  END IF;
  ALTER TABLE public.market_provider_policies ADD CONSTRAINT market_provider_policies_source_type_check
    CHECK (source_type IN ('zillow','investorlift','redfin','realtor','crexi','loopnet','generic','manual_url','other'));
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='public' AND table_name='market_provider_import_events' AND constraint_name='market_provider_import_events_source_type_check') THEN
    ALTER TABLE public.market_provider_import_events DROP CONSTRAINT market_provider_import_events_source_type_check;
    ALTER TABLE public.market_provider_import_events ADD CONSTRAINT market_provider_import_events_source_type_check
      CHECK (source_type IN ('zillow', 'investorlift', 'crexi', 'loopnet', 'redfin', 'realtor', 'apartments', 'csv', 'partner_api', 'mls_feed', 'manual', 'manual_url', 'other'));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='public' AND table_name='market_source_imports' AND constraint_name='market_source_imports_source_type_check') THEN
    ALTER TABLE public.market_source_imports DROP CONSTRAINT market_source_imports_source_type_check;
    ALTER TABLE public.market_source_imports ADD CONSTRAINT market_source_imports_source_type_check
      CHECK (source_type IN ('zillow', 'investorlift', 'crexi', 'apartments', 'realtor', 'redfin', 'csv', 'licensed_api', 'other'));
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
VALUES (
  NULL,
  'investorlift',
  'InvestorLift',
  true,
  40,
  NULL,
  15,
  true,
  true,
  true,
  true,
  true,
  true,
  'Authorized InvestorLift live import only. 40 listing imports per organization per rolling hour. No demo mode, proxy rotation, CAPTCHA bypass, or anti-bot circumvention.'
)
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

COMMENT ON COLUMN public.market_provider_policies.max_listings_per_hour IS 'Rolling hourly import cap per organization/provider. InvestorLift default is 40/hour based on configured provider access.';
