-- Batch 12I.x — make market listing analysis inputs and score cache the source of truth.
-- This migration is intentionally idempotent.

ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS target_rent numeric(14,2);
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS capex_monthly numeric(14,2);
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS vacancy_percent numeric(7,3);
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS management_percent numeric(7,3);
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS down_payment_percent numeric(7,3);
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS interest_rate_percent numeric(7,3);
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS loan_term_months integer;
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS dscr_min_threshold numeric(7,3);
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS analysis_last_saved_at timestamptz;
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS analysis_last_saved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_market_listings_opportunity_cache
ON public.market_listings(organization_id, latest_deal_score DESC, latest_rent_confidence_score DESC, updated_at DESC)
WHERE latest_deal_score >= 80 AND latest_rent_confidence_score >= 65 AND status <> 'archived';

COMMENT ON COLUMN public.market_listings.analysis_last_saved_at IS 'Last time underwriting inputs were manually saved and score cache was recalculated.';
COMMENT ON COLUMN public.market_listings.target_rent IS 'Optional target rent used as a stronger underwriting rent input than market rent when present.';
