-- DealFlowIQ Batch — Import engine quality hardening.
-- Ensures InvestorLift remains a real live provider, existing listings retain image/source data,
-- and imported records have the normalized fields needed for scoring, rent intelligence and UI redirects.

create extension if not exists pgcrypto;

-- Keep source constraints aligned with the current provider list. Safe to run even if earlier migrations already did this.
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
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='public' AND table_name='market_import_preview_items' AND constraint_name='market_import_preview_items_source_type_check') THEN
    ALTER TABLE public.market_import_preview_items DROP CONSTRAINT market_import_preview_items_source_type_check;
    ALTER TABLE public.market_import_preview_items ADD CONSTRAINT market_import_preview_items_source_type_check
      CHECK (source_type IN ('manual', 'manual_url', 'zillow', 'investorlift', 'crexi', 'loopnet', 'redfin', 'realtor', 'apartments', 'csv', 'partner_api', 'mls_feed', 'public_deal', 'community_deal', 'other'));
  END IF;
END $$;

-- Re-assert InvestorLift policy as live provider, not demo/fallback.
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
  'Authorized InvestorLift live import only. 40 listing imports per organization per rolling hour. URL-only fallback is allowed when the provider returns an app/login shell; no listing fields are fabricated.'
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

-- Normalize image cache for older imports where image_urls existed but primary image was empty.
UPDATE public.market_listings
SET primary_image_url = image_urls->>0
WHERE primary_image_url IS NULL
  AND jsonb_typeof(image_urls) = 'array'
  AND jsonb_array_length(image_urls) > 0;

-- Keep comments explicit for future batches.
COMMENT ON COLUMN public.market_listings.image_urls IS 'Normalized imported image URLs. Importer stores multiple images when the authorized source exposes them.';
COMMENT ON COLUMN public.market_listings.description IS 'Source description/remarks when exposed by authorized provider; URL-only fallback never fabricates this field.';
COMMENT ON COLUMN public.market_listings.taxes_annual IS 'Annual property tax extracted from source, CSV/API, or manual import when available.';
COMMENT ON COLUMN public.market_listings.market_rent IS 'Market rent estimate used by DealFlowIQ scoring and rent intelligence. May be imported or filled by rent intelligence.';
COMMENT ON COLUMN public.market_listings.raw_payload IS 'Import trace, provider extraction status, fallback reason, original parser metadata and dedupe key.';
