-- Batch fix: HUD ZIP -> FMR entity resolution + rent guardrails.
-- Safe version for existing bad Zillow/import data.

-- 1. Clean invalid deal-level rents
UPDATE public.deals
SET market_rent = NULL
WHERE market_rent IS NOT NULL
  AND (market_rent < 250 OR market_rent > 50000);

UPDATE public.deals
SET current_rent = NULL
WHERE current_rent IS NOT NULL
  AND (current_rent < 0 OR current_rent > 50000);

UPDATE public.deals
SET section8_rent = NULL
WHERE section8_rent IS NOT NULL
  AND (section8_rent < 0 OR section8_rent > 50000);

UPDATE public.deals
SET target_rent = NULL
WHERE target_rent IS NOT NULL
  AND (target_rent < 0 OR target_rent > 50000);


-- 2. Make sure import_status constraint allows ignored/failed states
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'market_rent_comps'
      AND constraint_name = 'market_rent_comps_import_status_check'
  ) THEN
    ALTER TABLE public.market_rent_comps
      DROP CONSTRAINT market_rent_comps_import_status_check;
  END IF;

  ALTER TABLE public.market_rent_comps
    ADD CONSTRAINT market_rent_comps_import_status_check
    CHECK (
      import_status IS NULL
      OR import_status IN ('manual', 'pending', 'imported', 'failed', 'ignored')
    );
END $$;


-- 3. Allow failed/ignored comps without monthly rent
ALTER TABLE public.market_rent_comps
  ALTER COLUMN monthly_rent DROP NOT NULL;


-- 4. Neutralize invalid comp rents
UPDATE public.market_rent_comps
SET
  monthly_rent = NULL,
  import_status = CASE
    WHEN import_status = 'manual' THEN 'failed'
    ELSE 'ignored'
  END,
  notes = CONCAT_WS(
    E'\n',
    NULLIF(notes, ''),
    'DealFlowIQ ignored this comp because monthly_rent was outside the production guardrail range $250-$50,000/month.'
  ),
  updated_at = now()
WHERE monthly_rent IS NOT NULL
  AND (monthly_rent < 250 OR monthly_rent > 50000);


-- 5. Replace monthly rent guardrail safely
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'market_rent_comps_monthly_rent_reasonable_check'
      AND conrelid = 'public.market_rent_comps'::regclass
  ) THEN
    ALTER TABLE public.market_rent_comps
      DROP CONSTRAINT market_rent_comps_monthly_rent_reasonable_check;
  END IF;

  ALTER TABLE public.market_rent_comps
    ADD CONSTRAINT market_rent_comps_monthly_rent_reasonable_check
    CHECK (
      monthly_rent IS NULL
      OR (monthly_rent >= 250 AND monthly_rent <= 50000)
    );
END $$;


-- 6. Comments
COMMENT ON CONSTRAINT market_rent_comps_monthly_rent_reasonable_check ON public.market_rent_comps IS
'Guardrail to prevent sale prices, Zillow IDs, property IDs, or malformed imports from being stored as monthly rent. Failed/ignored imports may have monthly_rent null.';

COMMENT ON COLUMN public.hud_fmr_cache.raw_response IS
'Raw HUDUSER response plus DealFlowIQ ZIP-to-FMR entity resolution metadata. Official FMR API expects an FMR entity id; ZIP lookup is resolved via HUD USPS Crosswalk first.';