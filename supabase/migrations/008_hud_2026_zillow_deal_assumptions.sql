-- DealFlowIQ Batch 6.1
-- 2026 HUD default, direct Zillow import metadata, and per-deal projection assumptions.
-- Run after 007_assumption_templates_rent_intelligence_hud.sql.

ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS rent_growth_percent numeric(8,3) DEFAULT 3;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS expense_growth_percent numeric(8,3) DEFAULT 3;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS exit_cap_rate_percent numeric(8,3) DEFAULT 7;

ALTER TABLE public.deals DROP CONSTRAINT IF EXISTS deals_projection_assumptions_check;
ALTER TABLE public.deals ADD CONSTRAINT deals_projection_assumptions_check CHECK (
  COALESCE(rent_growth_percent, 0) >= -100
  AND COALESCE(expense_growth_percent, 0) >= -100
  AND COALESCE(exit_cap_rate_percent, 0) >= 0
);

ALTER TABLE public.market_rent_comps ADD COLUMN IF NOT EXISTS external_listing_id text;
ALTER TABLE public.market_rent_comps ADD COLUMN IF NOT EXISTS import_status text NOT NULL DEFAULT 'manual' CHECK (import_status IN ('manual', 'imported', 'failed', 'verified'));
ALTER TABLE public.market_rent_comps ADD COLUMN IF NOT EXISTS raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_market_rent_comps_external_listing
ON public.market_rent_comps(source_type, external_listing_id)
WHERE external_listing_id IS NOT NULL;

COMMENT ON COLUMN public.deals.rent_growth_percent IS 'Editable per-deal annual rent-growth assumption used by projection/scenario modules.';
COMMENT ON COLUMN public.deals.expense_growth_percent IS 'Editable per-deal annual expense-growth assumption used by projection/scenario modules.';
COMMENT ON COLUMN public.deals.exit_cap_rate_percent IS 'Editable per-deal exit cap-rate assumption used by future value/projection modules.';
COMMENT ON COLUMN public.market_rent_comps.raw_payload IS 'Raw extraction/import metadata from Zillow or other authorized data sources. Do not treat imported values as verified until reviewed.';
COMMENT ON COLUMN public.market_rent_comps.import_status IS 'manual/imported/failed/verified status for imported market-rent comps.';
