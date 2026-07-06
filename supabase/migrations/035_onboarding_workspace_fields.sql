-- =============================================================================
-- 035 — Onboarding workspace fields
--
-- Stores the primary market and strategy chosen during first-run onboarding
-- on the organization so imports, buy boxes and analytics can default to it.
-- =============================================================================

ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS primary_market text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS primary_strategy text
  CHECK (primary_strategy IS NULL OR primary_strategy IN (
    'buy_and_hold', 'section8', 'brrrr', 'fix_and_flip', 'wholesale', 'seller_finance', 'mixed'
  ));

COMMENT ON COLUMN public.organizations.primary_market IS 'Free-text primary market/location chosen during onboarding (e.g. "Cleveland, OH").';
COMMENT ON COLUMN public.organizations.primary_strategy IS 'Primary investment strategy chosen during onboarding.';
