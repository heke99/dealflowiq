-- =============================================================================
-- 036 — Flip holding period
--
-- The flip profit preview previously treated holding_costs_monthly as a
-- one-time cost. The engine now multiplies it by an editable holding period
-- (default 6 months). This column stores the per-deal override.
-- =============================================================================

ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS flip_holding_months integer
  CHECK (flip_holding_months IS NULL OR (flip_holding_months >= 0 AND flip_holding_months <= 60));

COMMENT ON COLUMN public.deals.flip_holding_months IS 'Months of holding costs assumed in the flip profit preview (engine default: 6).';
