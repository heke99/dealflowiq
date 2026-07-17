-- DealFlowIQ Batch 12I.3 — opportunity threshold update + existing listing backfill.
-- New rules:
-- Strong Opportunity: score >= 85 AND rent confidence >= 65
-- Opportunity:        score >= 70 AND rent confidence >= 50
-- Watchlist:          score >= 60 OR missing data
-- Needs Review:       score >= 60 but confidence below 60

ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS latest_opportunity_rank text;
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS latest_opportunity_rank_label text;
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS latest_opportunity_rank_reason text;

CREATE INDEX IF NOT EXISTS idx_market_listings_opportunity_70_50
ON public.market_listings(organization_id, latest_deal_score DESC, latest_rent_confidence_score DESC, updated_at DESC)
WHERE latest_deal_score >= 70 AND latest_rent_confidence_score >= 50 AND status <> 'archived';

-- Keep configured source/buy-box defaults aligned with the new promotion gates.
UPDATE public.market_sources
SET opportunity_score_threshold = 70
WHERE opportunity_score_threshold IS NULL OR opportunity_score_threshold = 80;

UPDATE public.market_buy_boxes
SET min_deal_score = 70
WHERE min_deal_score IS NULL OR min_deal_score = 80;

UPDATE public.market_buy_boxes
SET min_rent_confidence = 50
WHERE min_rent_confidence IS NULL OR min_rent_confidence = 65;

-- Backfill cached score fields from the best historical score row so old listings are evaluated too.
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
  ORDER BY listing_id, deal_score DESC, rent_confidence_score DESC, calculated_at DESC
)
UPDATE public.market_listings ml
SET
  latest_score_id = COALESCE(bs.id, ml.latest_score_id),
  latest_deal_score = COALESCE(GREATEST(COALESCE(ml.latest_deal_score, 0), COALESCE(bs.deal_score, 0)), ml.latest_deal_score),
  latest_rent_confidence_score = COALESCE(GREATEST(COALESCE(ml.latest_rent_confidence_score, 0), COALESCE(bs.rent_confidence_score, 0)), ml.latest_rent_confidence_score),
  latest_source_confidence_score = COALESCE(bs.source_confidence_score, ml.latest_source_confidence_score),
  latest_data_confidence_score = COALESCE(bs.data_confidence_score, ml.latest_data_confidence_score),
  latest_estimated_monthly_cashflow = COALESCE(bs.estimated_monthly_cashflow, ml.latest_estimated_monthly_cashflow),
  latest_estimated_dscr = COALESCE(bs.estimated_dscr, ml.latest_estimated_dscr),
  latest_estimated_cap_rate = COALESCE(bs.estimated_cap_rate, ml.latest_estimated_cap_rate),
  latest_break_even_rent = COALESCE(bs.break_even_rent, ml.latest_break_even_rent),
  latest_score_calculated_at = COALESCE(bs.calculated_at, ml.latest_score_calculated_at)
FROM best_scores bs
WHERE ml.id = bs.listing_id;

-- Classify all existing listings using the new gates. Do not unarchive or overwrite converted deals.
UPDATE public.market_listings ml
SET
  latest_opportunity_rank = CASE
    WHEN COALESCE(latest_deal_score, 0) >= 85 AND COALESCE(latest_rent_confidence_score, 0) >= 65 THEN 'strong_opportunity'
    WHEN COALESCE(latest_deal_score, 0) >= 70 AND COALESCE(latest_rent_confidence_score, 0) >= 50 THEN 'opportunity'
    WHEN COALESCE(latest_deal_score, 0) >= 60 AND COALESCE(latest_rent_confidence_score, 0) < 60 THEN 'needs_review'
    WHEN COALESCE(latest_deal_score, 0) >= 60 OR deal_status = 'missing_data' THEN 'watchlist'
    ELSE 'market_only'
  END,
  latest_opportunity_rank_label = CASE
    WHEN COALESCE(latest_deal_score, 0) >= 85 AND COALESCE(latest_rent_confidence_score, 0) >= 65 THEN 'Strong Opportunity'
    WHEN COALESCE(latest_deal_score, 0) >= 70 AND COALESCE(latest_rent_confidence_score, 0) >= 50 THEN 'Opportunity'
    WHEN COALESCE(latest_deal_score, 0) >= 60 AND COALESCE(latest_rent_confidence_score, 0) < 60 THEN 'Needs Review'
    WHEN COALESCE(latest_deal_score, 0) >= 60 OR deal_status = 'missing_data' THEN 'Watchlist'
    ELSE 'Market Only'
  END,
  latest_opportunity_rank_reason = CASE
    WHEN COALESCE(latest_deal_score, 0) >= 85 AND COALESCE(latest_rent_confidence_score, 0) >= 65 THEN 'Score and rent confidence meet Strong Opportunity rules.'
    WHEN COALESCE(latest_deal_score, 0) >= 70 AND COALESCE(latest_rent_confidence_score, 0) >= 50 THEN 'Score and rent confidence meet Opportunity rules.'
    WHEN COALESCE(latest_deal_score, 0) >= 60 AND COALESCE(latest_rent_confidence_score, 0) < 60 THEN 'Score is promising but rent confidence needs review.'
    WHEN COALESCE(latest_deal_score, 0) >= 60 OR deal_status = 'missing_data' THEN 'Listing is worth keeping on the watchlist or needs missing data review.'
    ELSE 'Listing does not meet Watchlist or Opportunity rules yet.'
  END,
  deal_status = CASE
    WHEN status = 'archived' THEN 'archived'
    WHEN COALESCE(latest_deal_score, 0) >= 70 AND COALESCE(latest_rent_confidence_score, 0) >= 50 THEN 'ready'
    WHEN COALESCE(latest_deal_score, 0) >= 60 AND COALESCE(latest_rent_confidence_score, 0) < 60 THEN 'low_confidence'
    WHEN deal_status = 'missing_data' THEN 'missing_data'
    ELSE COALESCE(deal_status, 'needs_review')
  END,
  deal_stage = CASE
    WHEN status = 'archived' THEN 'archived'
    WHEN COALESCE(latest_deal_score, 0) >= 70 AND COALESCE(latest_rent_confidence_score, 0) >= 50 THEN 'opportunity'
    WHEN COALESCE(latest_deal_score, 0) >= 60 AND COALESCE(latest_rent_confidence_score, 0) < 60 THEN 'needs_review'
    WHEN COALESCE(latest_deal_score, 0) >= 60 OR deal_status = 'missing_data' THEN 'watchlist'
    ELSE COALESCE(deal_stage, 'imported')
  END,
  status = CASE
    WHEN status IN ('archived', 'converted_to_deal') THEN status
    WHEN COALESCE(latest_deal_score, 0) >= 70 AND COALESCE(latest_rent_confidence_score, 0) >= 50 THEN 'opportunity'
    WHEN COALESCE(latest_deal_score, 0) >= 60 AND COALESCE(latest_rent_confidence_score, 0) < 60 THEN 'needs_review'
    ELSE status
  END,
  review_reason = CASE
    WHEN COALESCE(latest_deal_score, 0) >= 85 AND COALESCE(latest_rent_confidence_score, 0) >= 65 THEN 'Strong Opportunity: score >= 85 and rent confidence >= 65.'
    WHEN COALESCE(latest_deal_score, 0) >= 70 AND COALESCE(latest_rent_confidence_score, 0) >= 50 THEN 'Opportunity: score >= 70 and rent confidence >= 50.'
    WHEN COALESCE(latest_deal_score, 0) >= 60 AND COALESCE(latest_rent_confidence_score, 0) < 60 THEN 'Needs Review: score >= 60 but rent confidence below 60.'
    WHEN COALESCE(latest_deal_score, 0) >= 60 THEN 'Watchlist: score >= 60.'
    ELSE review_reason
  END,
  updated_at = now()
WHERE status <> 'archived';

COMMENT ON COLUMN public.market_listings.latest_opportunity_rank IS 'Opportunity rank under current DealFlowIQ gates: strong_opportunity, opportunity, watchlist, needs_review, market_only.';
COMMENT ON COLUMN public.market_listings.latest_opportunity_rank_reason IS 'Why the current rank was assigned. Used for explainability and backfilled listing review.';
