-- DealFlowIQ Batch 1.3 + Batch 3
-- Universal core access + plan-based gating + core deal foundation.
-- Run after 003_subscription_plan_foundation.sql.

create extension if not exists pgcrypto;

-- 1) Make core features universal in stored plans too. Account type personalizes; plan gates premium/limits.
UPDATE public.billing_plans
SET features = COALESCE(features, '{}'::jsonb) || '{
  "deals": true,
  "deal_analyzer": true,
  "market_search": true,
  "rent_analysis": true,
  "market_rent": true,
  "calculators": true
}'::jsonb,
updated_at = now();

-- 2) Core deal table. Keep this broad enough for MVP, but not overloaded with every future calculator.
CREATE TABLE IF NOT EXISTS public.deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'imported', 'needs_review', 'analyzed', 'approved', 'rejected', 'under_contract', 'sent_to_buyers', 'offers_received', 'assigned', 'closed', 'dead')),
  source_url text,
  source_platform text,
  property_type text,
  asking_price numeric(14,2),
  contract_price numeric(14,2),
  purchase_price numeric(14,2),
  arv numeric(14,2),
  rehab_estimate numeric(14,2),
  current_rent numeric(14,2),
  market_rent numeric(14,2),
  section8_rent numeric(14,2),
  target_rent numeric(14,2),
  taxes_annual numeric(14,2),
  insurance_annual numeric(14,2),
  hoa_monthly numeric(14,2),
  utilities_monthly numeric(14,2),
  vacancy_percent numeric(6,3),
  management_percent numeric(6,3),
  capex_monthly numeric(14,2),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL UNIQUE REFERENCES public.deals(id) ON DELETE CASCADE,
  address text,
  city text,
  state text,
  zip_code text,
  county text,
  bedrooms numeric(6,2),
  bathrooms numeric(6,2),
  square_feet integer,
  lot_size text,
  year_built integer,
  number_of_units integer NOT NULL DEFAULT 1 CHECK (number_of_units >= 1),
  occupancy_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.deal_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  unit_label text,
  unit_type text,
  bedrooms numeric(6,2),
  bathrooms numeric(6,2),
  square_feet integer,
  current_rent numeric(14,2),
  market_rent numeric(14,2),
  section8_rent numeric(14,2),
  target_rent numeric(14,2),
  occupancy_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3) Updated-at triggers.
DROP TRIGGER IF EXISTS set_deals_updated_at ON public.deals;
CREATE TRIGGER set_deals_updated_at
BEFORE UPDATE ON public.deals
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_properties_updated_at ON public.properties;
CREATE TRIGGER set_properties_updated_at
BEFORE UPDATE ON public.properties
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_deal_units_updated_at ON public.deal_units;
CREATE TRIGGER set_deal_units_updated_at
BEFORE UPDATE ON public.deal_units
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4) RLS.
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deals_select_org_member ON public.deals;
CREATE POLICY deals_select_org_member
ON public.deals FOR SELECT
TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS deals_insert_org_member ON public.deals;
CREATE POLICY deals_insert_org_member
ON public.deals FOR INSERT
TO authenticated
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS deals_update_org_member ON public.deals;
CREATE POLICY deals_update_org_member
ON public.deals FOR UPDATE
TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS deals_delete_owner_admin ON public.deals;
CREATE POLICY deals_delete_owner_admin
ON public.deals FOR DELETE
TO authenticated
USING (public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS properties_select_org_member ON public.properties;
CREATE POLICY properties_select_org_member
ON public.properties FOR SELECT
TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS properties_insert_org_member ON public.properties;
CREATE POLICY properties_insert_org_member
ON public.properties FOR INSERT
TO authenticated
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS properties_update_org_member ON public.properties;
CREATE POLICY properties_update_org_member
ON public.properties FOR UPDATE
TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS properties_delete_owner_admin ON public.properties;
CREATE POLICY properties_delete_owner_admin
ON public.properties FOR DELETE
TO authenticated
USING (public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS deal_units_select_org_member ON public.deal_units;
CREATE POLICY deal_units_select_org_member
ON public.deal_units FOR SELECT
TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS deal_units_insert_org_member ON public.deal_units;
CREATE POLICY deal_units_insert_org_member
ON public.deal_units FOR INSERT
TO authenticated
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS deal_units_update_org_member ON public.deal_units;
CREATE POLICY deal_units_update_org_member
ON public.deal_units FOR UPDATE
TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS deal_units_delete_owner_admin ON public.deal_units;
CREATE POLICY deal_units_delete_owner_admin
ON public.deal_units FOR DELETE
TO authenticated
USING (public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin());

-- 5) Helpful indexes.
CREATE INDEX IF NOT EXISTS idx_deals_org_created_at ON public.deals(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deals_org_status ON public.deals(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_deals_created_by ON public.deals(created_by);
CREATE INDEX IF NOT EXISTS idx_properties_org ON public.properties(organization_id);
CREATE INDEX IF NOT EXISTS idx_properties_deal ON public.properties(deal_id);
CREATE INDEX IF NOT EXISTS idx_properties_zip ON public.properties(zip_code);
CREATE INDEX IF NOT EXISTS idx_deal_units_org_deal ON public.deal_units(organization_id, deal_id);
