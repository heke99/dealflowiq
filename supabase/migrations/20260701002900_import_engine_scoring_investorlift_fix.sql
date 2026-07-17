-- DealFlowIQ Batch 12J — import engine, InvestorLift and scoring/rescore hardening.
-- Run after 024_market_import_job_type_policy_fix.sql.

-- 1) Allow InvestorLift wherever source types are constrained.
DO $$
BEGIN
  IF to_regclass('public.market_listings') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='public' AND table_name='market_listings' AND constraint_name='market_listings_source_type_check') THEN
      ALTER TABLE public.market_listings DROP CONSTRAINT market_listings_source_type_check;
    END IF;
    ALTER TABLE public.market_listings ADD CONSTRAINT market_listings_source_type_check
      CHECK (source_type IN ('manual', 'manual_url', 'zillow', 'crexi', 'loopnet', 'redfin', 'realtor', 'apartments', 'investorlift', 'csv', 'partner_api', 'mls_feed', 'public_deal', 'community_deal', 'other'));
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.market_sources') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='public' AND table_name='market_sources' AND constraint_name='market_sources_source_type_check') THEN
      ALTER TABLE public.market_sources DROP CONSTRAINT market_sources_source_type_check;
    END IF;
    ALTER TABLE public.market_sources ADD CONSTRAINT market_sources_source_type_check
      CHECK (source_type IN ('manual', 'manual_url', 'zillow', 'crexi', 'loopnet', 'redfin', 'realtor', 'apartments', 'investorlift', 'csv', 'partner_api', 'mls_feed', 'other'));
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.market_source_imports') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='public' AND table_name='market_source_imports' AND constraint_name='market_source_imports_source_type_check') THEN
      ALTER TABLE public.market_source_imports DROP CONSTRAINT market_source_imports_source_type_check;
    END IF;
    ALTER TABLE public.market_source_imports ADD CONSTRAINT market_source_imports_source_type_check
      CHECK (source_type IN ('zillow', 'crexi', 'apartments', 'realtor', 'redfin', 'investorlift', 'csv', 'licensed_api', 'other'));
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.market_url_import_batches') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='public' AND table_name='market_url_import_batches' AND constraint_name='market_url_import_batches_source_type_check') THEN
      ALTER TABLE public.market_url_import_batches DROP CONSTRAINT market_url_import_batches_source_type_check;
    END IF;
    ALTER TABLE public.market_url_import_batches ADD CONSTRAINT market_url_import_batches_source_type_check
      CHECK (source_type IN ('manual', 'manual_url', 'zillow', 'crexi', 'loopnet', 'redfin', 'realtor', 'apartments', 'investorlift', 'csv', 'partner_api', 'mls_feed', 'public_deal', 'community_deal', 'other'));
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.market_provider_policies') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='public' AND table_name='market_provider_policies' AND constraint_name='market_provider_policies_source_type_check') THEN
      ALTER TABLE public.market_provider_policies DROP CONSTRAINT market_provider_policies_source_type_check;
    END IF;
    ALTER TABLE public.market_provider_policies ADD CONSTRAINT market_provider_policies_source_type_check
      CHECK (source_type IN ('zillow','redfin','realtor','crexi','loopnet','apartments','investorlift','generic','manual_url','manual','csv','partner_api','mls_feed','other'));
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.market_provider_import_events') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='public' AND table_name='market_provider_import_events' AND constraint_name='market_provider_import_events_source_type_check') THEN
      ALTER TABLE public.market_provider_import_events DROP CONSTRAINT market_provider_import_events_source_type_check;
    END IF;
    ALTER TABLE public.market_provider_import_events ADD CONSTRAINT market_provider_import_events_source_type_check
      CHECK (source_type IN ('zillow', 'crexi', 'loopnet', 'redfin', 'realtor', 'apartments', 'investorlift', 'csv', 'partner_api', 'mls_feed', 'manual', 'manual_url', 'other'));
  END IF;
END $$;

-- 2) Seed the live InvestorLift policy: no demo mode, 40 listings per rolling hour.
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
  'Authorized InvestorLift live import. 40 listings per rolling hour. No demo mode, proxy rotation, CAPTCHA bypass, or anti-bot circumvention.'
)
ON CONFLICT (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), source_type)
DO UPDATE SET
  provider_label = EXCLUDED.provider_label,
  is_active = true,
  max_listings_per_hour = 40,
  max_listings_per_day = NULL,
  storage_days = EXCLUDED.storage_days,
  images_allowed = true,
  description_allowed = true,
  source_link_required = true,
  attribution_required = true,
  search_import_allowed = true,
  listing_import_allowed = true,
  provider_notes = EXCLUDED.provider_notes,
  updated_at = now();

-- 3) Backfill existing InvestorLift rows that were previously stored as manual/generic.
UPDATE public.market_listings
SET source_type = 'investorlift',
    raw_payload = COALESCE(raw_payload, '{}'::jsonb) || jsonb_build_object('sourceTypeBackfilledAt', now(), 'sourceTypeBackfilledFrom', source_type)
WHERE source_url ILIKE '%investorlift.%'
  AND source_type IN ('manual', 'manual_url', 'other');

UPDATE public.market_sources
SET source_type = 'investorlift',
    settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('sourceTypeBackfilledAt', now(), 'max_urls_per_run', 40)
WHERE source_type IN ('manual', 'manual_url', 'other')
  AND COALESCE(settings::text, '') ILIKE '%investorlift.%';

UPDATE public.market_url_import_batches
SET source_type = 'investorlift',
    policy_snapshot = COALESCE(policy_snapshot, '{}'::jsonb) || jsonb_build_object('sourceTypeBackfilledAt', now())
WHERE COALESCE(input_url, normalized_url, '') ILIKE '%investorlift.%'
  AND source_type IN ('manual', 'manual_url', 'other');

-- 4) Keep listing cards/images and latest score cache consistent after older imports.
UPDATE public.market_listings
SET primary_image_url = image_urls->>0
WHERE primary_image_url IS NULL
  AND jsonb_typeof(image_urls) = 'array'
  AND jsonb_array_length(image_urls) > 0;

WITH latest AS (
  SELECT DISTINCT ON (listing_id)
    listing_id,
    id AS score_id,
    deal_score,
    rent_confidence_score,
    source_confidence_score,
    data_confidence_score,
    estimated_monthly_cashflow,
    estimated_dscr,
    estimated_cap_rate,
    break_even_rent,
    calculated_at
  FROM public.market_listing_scores
  ORDER BY listing_id, calculated_at DESC, created_at DESC
)
UPDATE public.market_listings ml
SET latest_score_id = latest.score_id,
    latest_deal_score = latest.deal_score,
    latest_rent_confidence_score = latest.rent_confidence_score,
    latest_source_confidence_score = latest.source_confidence_score,
    latest_data_confidence_score = latest.data_confidence_score,
    latest_estimated_monthly_cashflow = latest.estimated_monthly_cashflow,
    latest_estimated_dscr = latest.estimated_dscr,
    latest_estimated_cap_rate = latest.estimated_cap_rate,
    latest_break_even_rent = latest.break_even_rent,
    latest_score_calculated_at = latest.calculated_at
FROM latest
WHERE latest.listing_id = ml.id;

COMMENT ON TABLE public.market_sources IS 'Configured source connectors. Source submit can immediately run the import; InvestorLift is a live authorized provider capped at 40 listings/hour.';
COMMENT ON COLUMN public.market_listings.latest_score_calculated_at IS 'Updated every time import/edit/rent intelligence/HUD/manual override rescoring runs.';
