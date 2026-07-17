-- DealFlowIQ Batch 12I.2 repair — active providers and no-demo import workflow.
-- Safe to run after 018/019 migrations. Does not create demo import mode.

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
  (NULL, 'zillow', 'Zillow', true, 10, NULL, 15, true, true, true, true, true, true, 'Authorized live import only. No proxy rotation, CAPTCHA bypass, or anti-bot circumvention.'),
  (NULL, 'redfin', 'Redfin', true, 10, NULL, 15, true, true, true, true, true, true, 'Authorized live import under same documented provider policy as Zillow. No proxy rotation, CAPTCHA bypass, or anti-bot circumvention.'),
  (NULL, 'realtor', 'Realtor.com', true, 10, NULL, 15, true, true, true, true, true, true, 'Authorized live import under same documented provider policy as Zillow. No proxy rotation, CAPTCHA bypass, or anti-bot circumvention.'),
  (NULL, 'crexi', 'Crexi', true, 10, NULL, 15, true, true, true, true, true, true, 'Authorized live import under same documented provider policy as Zillow. No proxy rotation, CAPTCHA bypass, or anti-bot circumvention.'),
  (NULL, 'loopnet', 'LoopNet', true, 10, NULL, 15, true, true, true, true, true, true, 'Authorized live import under same documented provider policy as Zillow. No proxy rotation, CAPTCHA bypass, or anti-bot circumvention.'),
  (NULL, 'generic', 'Generic authorized URL', false, 0, NULL, 15, false, false, true, true, false, false, 'Fallback only. Keep inactive unless permission and rate limits are documented.')
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
