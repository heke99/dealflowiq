-- DealFlowIQ production fix: HUD token diagnostics, Zillow import status compatibility,
-- and cleanup of stale analyzer values from earlier test imports/default assumptions.

-- 1) Ensure market comp status supports ignored rows.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'market_rent_comps'
      AND constraint_name = 'market_rent_comps_import_status_check'
  ) THEN
    ALTER TABLE public.market_rent_comps DROP CONSTRAINT market_rent_comps_import_status_check;
  END IF;

  ALTER TABLE public.market_rent_comps
    ADD CONSTRAINT market_rent_comps_import_status_check
    CHECK (import_status IS NULL OR import_status IN ('manual', 'pending', 'imported', 'failed', 'ignored'));
END $$;

-- 2) Failed/ignored imports may have no monthly rent.
ALTER TABLE public.market_rent_comps
  ALTER COLUMN monthly_rent DROP NOT NULL;

-- 3) Clean bad Zillow imports/property IDs/sale prices saved as monthly rent.
UPDATE public.market_rent_comps
SET monthly_rent = NULL,
    import_status = CASE WHEN import_status = 'manual' THEN 'failed' ELSE 'ignored' END,
    notes = CONCAT_WS(E'\n', NULLIF(notes, ''), 'Ignored automatically: monthly_rent was outside DealFlowIQ production guardrail range $250-$50,000/month.'),
    updated_at = now()
WHERE monthly_rent IS NOT NULL
  AND (monthly_rent < 250 OR monthly_rent > 50000);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'market_rent_comps_monthly_rent_reasonable_check'
      AND conrelid = 'public.market_rent_comps'::regclass
  ) THEN
    ALTER TABLE public.market_rent_comps DROP CONSTRAINT market_rent_comps_monthly_rent_reasonable_check;
  END IF;

  ALTER TABLE public.market_rent_comps
    ADD CONSTRAINT market_rent_comps_monthly_rent_reasonable_check
    CHECK (monthly_rent IS NULL OR (monthly_rent >= 250 AND monthly_rent <= 50000));
END $$;

-- 4) Clean deal-level rent fields that came from bad imports.
UPDATE public.deals SET market_rent = NULL WHERE market_rent IS NOT NULL AND (market_rent < 250 OR market_rent > 50000);
UPDATE public.deals SET current_rent = NULL WHERE current_rent IS NOT NULL AND (current_rent < 0 OR current_rent > 50000);
UPDATE public.deals SET section8_rent = NULL WHERE section8_rent IS NOT NULL AND (section8_rent < 0 OR section8_rent > 50000);
UPDATE public.deals SET target_rent = NULL WHERE target_rent IS NOT NULL AND (target_rent < 0 OR target_rent > 50000);

-- 5) Earlier test data could leave default-looking debt service on deals with no valuation.
-- Do not keep a 280k loan on a deal where no purchase/contract/asking price exists.
UPDATE public.deals
SET loan_amount = NULL
WHERE loan_amount = 280000
  AND purchase_price IS NULL
  AND contract_price IS NULL
  AND asking_price IS NULL;

COMMENT ON CONSTRAINT market_rent_comps_monthly_rent_reasonable_check ON public.market_rent_comps IS
'Prevents sale prices, Zillow IDs, property IDs, or malformed imports from being stored as monthly rent. Failed/ignored imports may have monthly_rent null.';
