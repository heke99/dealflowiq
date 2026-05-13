-- DealFlowIQ Batch 5.1 — Editable formula assumptions and calculation snapshots.
-- Run after 005_admin_access_and_financial_engine.sql.

create extension if not exists pgcrypto;

-- 1) Add explicit underwriting assumptions to deals so formulas are not hardcoded.
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS loan_term_months integer DEFAULT 360;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS dscr_min_threshold numeric(8,3) DEFAULT 1.20;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS cap_rate_basis text NOT NULL DEFAULT 'purchase_price';
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS cap_rate_custom_value numeric(14,2);
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS mao_percentage numeric(8,3) DEFAULT 70;

ALTER TABLE public.deals DROP CONSTRAINT IF EXISTS deals_formula_assumptions_check;
ALTER TABLE public.deals ADD CONSTRAINT deals_formula_assumptions_check CHECK (
  COALESCE(loan_term_months, 0) >= 0
  AND COALESCE(dscr_min_threshold, 0) >= 0
  AND cap_rate_basis IN ('purchase_price', 'arv', 'custom_value')
  AND COALESCE(cap_rate_custom_value, 0) >= 0
  AND COALESCE(mao_percentage, 0) >= 0
  AND COALESCE(mao_percentage, 0) <= 100
);

-- 2) Historical calculation snapshots. These preserve formula version, assumptions and results.
CREATE TABLE IF NOT EXISTS public.deal_calculation_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  snapshot_name text NOT NULL DEFAULT 'Underwriting snapshot',
  formula_version text NOT NULL,
  assumptions jsonb NOT NULL DEFAULT '{}'::jsonb,
  results jsonb NOT NULL DEFAULT '{}'::jsonb,
  formula_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.deal_calculation_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_calculation_snapshots_select_org_member ON public.deal_calculation_snapshots;
CREATE POLICY deal_calculation_snapshots_select_org_member
ON public.deal_calculation_snapshots FOR SELECT
TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS deal_calculation_snapshots_insert_org_member ON public.deal_calculation_snapshots;
CREATE POLICY deal_calculation_snapshots_insert_org_member
ON public.deal_calculation_snapshots FOR INSERT
TO authenticated
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS deal_calculation_snapshots_delete_owner_admin ON public.deal_calculation_snapshots;
CREATE POLICY deal_calculation_snapshots_delete_owner_admin
ON public.deal_calculation_snapshots FOR DELETE
TO authenticated
USING (public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin());

CREATE INDEX IF NOT EXISTS idx_deal_calculation_snapshots_org_deal_created
ON public.deal_calculation_snapshots(organization_id, deal_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_deal_calculation_snapshots_deal
ON public.deal_calculation_snapshots(deal_id, created_at DESC);

-- 3) Helpful comments for future maintainers/admins.
COMMENT ON COLUMN public.deals.loan_term_months IS 'Editable amortization input used by the mortgage payment formula. Example: 360 for 30 years.';
COMMENT ON COLUMN public.deals.dscr_min_threshold IS 'Editable DSCR benchmark per lender/program. Example: 1.20, 1.25, 1.30.';
COMMENT ON COLUMN public.deals.cap_rate_basis IS 'Selected denominator for cap rate: purchase_price, arv, or custom_value.';
COMMENT ON COLUMN public.deals.mao_percentage IS 'Editable wholesale MAO percentage. 70 is only the default rule-of-thumb.';
COMMENT ON TABLE public.deal_calculation_snapshots IS 'Stores immutable underwriting snapshots so historical analyses do not change after assumptions are edited.';
