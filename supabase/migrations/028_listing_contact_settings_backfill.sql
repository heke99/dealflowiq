-- DealFlowIQ Batch 28 — Backfill contact settings for existing market listings.
-- Makes older listings explicitly message-enabled with private contact details by default.

INSERT INTO public.listing_contact_settings (
  listing_id,
  organization_id,
  allow_in_app_messages,
  email_visibility,
  phone_visibility,
  preferred_contact_method,
  created_by,
  updated_by,
  created_at,
  updated_at
)
SELECT
  ml.id,
  ml.organization_id,
  true,
  'hidden',
  'hidden',
  'in_app',
  ml.created_by,
  ml.created_by,
  now(),
  now()
FROM public.market_listings ml
WHERE NOT EXISTS (
  SELECT 1
  FROM public.listing_contact_settings lcs
  WHERE lcs.listing_id = ml.id
)
ON CONFLICT (listing_id) DO NOTHING;

COMMENT ON TABLE public.listing_contact_settings IS 'Per-listing contact settings. Existing listings are backfilled to allow in-app messaging while keeping email and phone hidden by default.';
