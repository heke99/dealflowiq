-- DealFlowIQ Batch 12I.3 — score/rent source-of-truth sync.
-- Run after 019_batch_12i2_multi_provider_rent_controls_no_demo.sql.

create extension if not exists pgcrypto;

ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS latest_score_id uuid REFERENCES public.market_listing_scores(id) ON DELETE SET NULL;
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS latest_deal_score numeric(6,2);
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS latest_rent_confidence_score numeric(6,2);
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS latest_source_confidence_score numeric(6,2);
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS latest_data_confidence_score numeric(6,2);
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS latest_estimated_monthly_cashflow numeric(14,2);
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS latest_estimated_dscr numeric(10,4);
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS latest_estimated_cap_rate numeric(10,6);
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS latest_break_even_rent numeric(14,2);
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS latest_score_calculated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_market_listings_latest_score
ON public.market_listings(organization_id, latest_deal_score DESC, latest_rent_confidence_score DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_scores_listing_best
ON public.market_listing_scores(listing_id, deal_score DESC, calculated_at DESC);

WITH best_scores AS (
  SELECT DISTINCT ON (listing_id)
    id,
    listing_id,
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
  ORDER BY listing_id, deal_score DESC, calculated_at DESC
)
UPDATE public.market_listings ml
SET
  latest_score_id = bs.id,
  latest_deal_score = bs.deal_score,
  latest_rent_confidence_score = bs.rent_confidence_score,
  latest_source_confidence_score = bs.source_confidence_score,
  latest_data_confidence_score = bs.data_confidence_score,
  latest_estimated_monthly_cashflow = bs.estimated_monthly_cashflow,
  latest_estimated_dscr = bs.estimated_dscr,
  latest_estimated_cap_rate = bs.estimated_cap_rate,
  latest_break_even_rent = bs.break_even_rent,
  latest_score_calculated_at = bs.calculated_at
FROM best_scores bs
WHERE ml.id = bs.listing_id
  AND (
    ml.latest_score_id IS DISTINCT FROM bs.id OR
    ml.latest_deal_score IS DISTINCT FROM bs.deal_score OR
    ml.latest_rent_confidence_score IS DISTINCT FROM bs.rent_confidence_score
  );

COMMENT ON COLUMN public.market_listings.latest_deal_score IS 'Cached best/current DealFlowIQ score used by Market and Opportunities cards so UI does not drift from score rows.';
COMMENT ON COLUMN public.market_listings.latest_rent_confidence_score IS 'Cached rent confidence paired with latest_deal_score.';
COMMENT ON COLUMN public.market_listings.latest_score_id IS 'Score row used as the current display/ranking source of truth.';
