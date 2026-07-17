-- DealFlowIQ Batch 5.1 + Batch 6
-- Assumption templates, organization underwriting defaults, market-rent comps and HUD/FMR cache.
-- Run after 006_editable_formula_assumptions_and_snapshots.sql.

create extension if not exists pgcrypto;

-- 1) Organization-level default assumptions. These are applied to new deals and used as fallback values.
CREATE TABLE IF NOT EXISTS public.organization_underwriting_defaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  default_template_id uuid,
  vacancy_percent numeric(8,3) NOT NULL DEFAULT 5,
  management_percent numeric(8,3) NOT NULL DEFAULT 8,
  capex_monthly numeric(14,2) NOT NULL DEFAULT 0,
  down_payment_percent numeric(8,3) NOT NULL DEFAULT 20,
  interest_rate_percent numeric(8,3) NOT NULL DEFAULT 7,
  loan_term_months integer NOT NULL DEFAULT 360,
  dscr_min_threshold numeric(8,3) NOT NULL DEFAULT 1.20,
  cap_rate_basis text NOT NULL DEFAULT 'purchase_price',
  mao_percentage numeric(8,3) NOT NULL DEFAULT 70,
  desired_wholesale_fee numeric(14,2) NOT NULL DEFAULT 10000,
  selling_costs_percent numeric(8,3) NOT NULL DEFAULT 8,
  holding_costs_monthly numeric(14,2) NOT NULL DEFAULT 0,
  refinance_ltv_percent numeric(8,3) NOT NULL DEFAULT 75,
  rent_growth_percent numeric(8,3) NOT NULL DEFAULT 3,
  expense_growth_percent numeric(8,3) NOT NULL DEFAULT 3,
  exit_cap_rate_percent numeric(8,3) NOT NULL DEFAULT 7,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_underwriting_defaults_check CHECK (
    vacancy_percent >= 0 AND vacancy_percent <= 100
    AND management_percent >= 0 AND management_percent <= 100
    AND capex_monthly >= 0
    AND down_payment_percent >= 0 AND down_payment_percent <= 100
    AND interest_rate_percent >= 0
    AND loan_term_months > 0
    AND dscr_min_threshold >= 0
    AND cap_rate_basis IN ('purchase_price', 'arv', 'custom_value')
    AND mao_percentage >= 0 AND mao_percentage <= 100
    AND desired_wholesale_fee >= 0
    AND selling_costs_percent >= 0 AND selling_costs_percent <= 100
    AND holding_costs_monthly >= 0
    AND refinance_ltv_percent >= 0 AND refinance_ltv_percent <= 100
    AND rent_growth_percent >= -100
    AND expense_growth_percent >= -100
    AND exit_cap_rate_percent >= 0
  )
);

CREATE TABLE IF NOT EXISTS public.underwriting_assumption_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  template_name text NOT NULL,
  template_code text NOT NULL,
  description text,
  scope text NOT NULL DEFAULT 'organization' CHECK (scope IN ('system', 'organization')),
  is_default boolean NOT NULL DEFAULT false,
  assumptions jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT underwriting_templates_scope_org_check CHECK (
    (scope = 'system' AND organization_id IS NULL) OR (scope = 'organization' AND organization_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_underwriting_templates_org_code
ON public.underwriting_assumption_templates(COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), template_code);

-- 2) Market-rent comps. Zillow and similar portals are stored as source URLs/manual comps unless a licensed API is added later.
CREATE TABLE IF NOT EXISTS public.market_rent_comps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  deal_id uuid REFERENCES public.deals(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source_type text NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual', 'zillow_url', 'licensed_api', 'csv_upload', 'pdf_upload', 'ai_extracted', 'other')),
  source_name text,
  source_url text,
  comp_address text,
  city text,
  state text,
  zip_code text,
  bedrooms numeric(6,2),
  bathrooms numeric(6,2),
  square_feet integer,
  monthly_rent numeric(14,2) NOT NULL CHECK (monthly_rent >= 0),
  distance_miles numeric(10,2),
  rent_per_sqft numeric(14,4) GENERATED ALWAYS AS (
    CASE WHEN square_feet IS NOT NULL AND square_feet > 0 THEN monthly_rent / square_feet ELSE NULL END
  ) STORED,
  listing_date date,
  notes text,
  confidence_score integer CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3) HUD/FMR cache. Values are cached by ZIP/year and can be updated from HUD USER API.
CREATE TABLE IF NOT EXISTS public.hud_fmr_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zip_code text NOT NULL,
  state text,
  county text,
  metro_area text,
  hud_year integer NOT NULL,
  rent_0br numeric(14,2),
  rent_1br numeric(14,2),
  rent_2br numeric(14,2),
  rent_3br numeric(14,2),
  rent_4br numeric(14,2),
  source text NOT NULL DEFAULT 'HUDUSER',
  source_url text,
  raw_response jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(zip_code, hud_year)
);

CREATE TABLE IF NOT EXISTS public.hud_lookup_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  deal_id uuid REFERENCES public.deals(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  zip_code text NOT NULL,
  bedrooms numeric(6,2),
  hud_year integer,
  status text NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed', 'cache_hit', 'manual_override')),
  message text,
  source_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4) Updated-at triggers.
DROP TRIGGER IF EXISTS set_organization_underwriting_defaults_updated_at ON public.organization_underwriting_defaults;
CREATE TRIGGER set_organization_underwriting_defaults_updated_at
BEFORE UPDATE ON public.organization_underwriting_defaults
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_underwriting_assumption_templates_updated_at ON public.underwriting_assumption_templates;
CREATE TRIGGER set_underwriting_assumption_templates_updated_at
BEFORE UPDATE ON public.underwriting_assumption_templates
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_market_rent_comps_updated_at ON public.market_rent_comps;
CREATE TRIGGER set_market_rent_comps_updated_at
BEFORE UPDATE ON public.market_rent_comps
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_hud_fmr_cache_updated_at ON public.hud_fmr_cache;
CREATE TRIGGER set_hud_fmr_cache_updated_at
BEFORE UPDATE ON public.hud_fmr_cache
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5) RLS.
ALTER TABLE public.organization_underwriting_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.underwriting_assumption_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_rent_comps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hud_fmr_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hud_lookup_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_underwriting_defaults_select_org ON public.organization_underwriting_defaults;
CREATE POLICY organization_underwriting_defaults_select_org ON public.organization_underwriting_defaults
FOR SELECT TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS organization_underwriting_defaults_upsert_admin ON public.organization_underwriting_defaults;
CREATE POLICY organization_underwriting_defaults_upsert_admin ON public.organization_underwriting_defaults
FOR INSERT TO authenticated
WITH CHECK (public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS organization_underwriting_defaults_update_admin ON public.organization_underwriting_defaults;
CREATE POLICY organization_underwriting_defaults_update_admin ON public.organization_underwriting_defaults
FOR UPDATE TO authenticated
USING (public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin())
WITH CHECK (public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS underwriting_templates_select ON public.underwriting_assumption_templates;
CREATE POLICY underwriting_templates_select ON public.underwriting_assumption_templates
FOR SELECT TO authenticated
USING (scope = 'system' OR public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS underwriting_templates_insert_admin ON public.underwriting_assumption_templates;
CREATE POLICY underwriting_templates_insert_admin ON public.underwriting_assumption_templates
FOR INSERT TO authenticated
WITH CHECK (public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS underwriting_templates_update_admin ON public.underwriting_assumption_templates;
CREATE POLICY underwriting_templates_update_admin ON public.underwriting_assumption_templates
FOR UPDATE TO authenticated
USING (public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin())
WITH CHECK (public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS market_rent_comps_select_org ON public.market_rent_comps;
CREATE POLICY market_rent_comps_select_org ON public.market_rent_comps
FOR SELECT TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS market_rent_comps_insert_org ON public.market_rent_comps;
CREATE POLICY market_rent_comps_insert_org ON public.market_rent_comps
FOR INSERT TO authenticated
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS market_rent_comps_update_org ON public.market_rent_comps;
CREATE POLICY market_rent_comps_update_org ON public.market_rent_comps
FOR UPDATE TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS market_rent_comps_delete_admin ON public.market_rent_comps;
CREATE POLICY market_rent_comps_delete_admin ON public.market_rent_comps
FOR DELETE TO authenticated
USING (public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS hud_fmr_cache_select_authenticated ON public.hud_fmr_cache;
CREATE POLICY hud_fmr_cache_select_authenticated ON public.hud_fmr_cache
FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS hud_fmr_cache_write_authenticated ON public.hud_fmr_cache;
CREATE POLICY hud_fmr_cache_write_authenticated ON public.hud_fmr_cache
FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS hud_fmr_cache_update_authenticated ON public.hud_fmr_cache;
CREATE POLICY hud_fmr_cache_update_authenticated ON public.hud_fmr_cache
FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS hud_lookup_events_select_org ON public.hud_lookup_events;
CREATE POLICY hud_lookup_events_select_org ON public.hud_lookup_events
FOR SELECT TO authenticated
USING (organization_id IS NULL OR public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS hud_lookup_events_insert_org ON public.hud_lookup_events;
CREATE POLICY hud_lookup_events_insert_org ON public.hud_lookup_events
FOR INSERT TO authenticated
WITH CHECK (organization_id IS NULL OR public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

-- 6) Indexes.
CREATE INDEX IF NOT EXISTS idx_underwriting_defaults_org ON public.organization_underwriting_defaults(organization_id);
CREATE INDEX IF NOT EXISTS idx_market_rent_comps_org_deal_created ON public.market_rent_comps(organization_id, deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_rent_comps_zip_beds ON public.market_rent_comps(zip_code, bedrooms, monthly_rent);
CREATE INDEX IF NOT EXISTS idx_hud_fmr_cache_zip_year ON public.hud_fmr_cache(zip_code, hud_year);
CREATE INDEX IF NOT EXISTS idx_hud_lookup_events_org_created ON public.hud_lookup_events(organization_id, created_at DESC);

-- 7) Seed system templates.
INSERT INTO public.underwriting_assumption_templates (scope, organization_id, template_name, template_code, description, is_default, assumptions)
VALUES
('system', NULL, 'Conservative Rental', 'conservative_rental', 'Higher vacancy/management and lender-safe DSCR defaults.', false, '{"vacancy_percent":8,"management_percent":10,"dscr_min_threshold":1.25,"mao_percentage":65,"refinance_ltv_percent":70,"selling_costs_percent":9,"rent_growth_percent":2,"expense_growth_percent":4}'::jsonb),
('system', NULL, 'Base Case Rental', 'base_case_rental', 'Balanced default assumptions for buy-and-hold underwriting.', true, '{"vacancy_percent":5,"management_percent":8,"dscr_min_threshold":1.20,"mao_percentage":70,"refinance_ltv_percent":75,"selling_costs_percent":8,"rent_growth_percent":3,"expense_growth_percent":3}'::jsonb),
('system', NULL, 'Aggressive Rental', 'aggressive_rental', 'Optimistic underwriting. Use carefully.', false, '{"vacancy_percent":3,"management_percent":6,"dscr_min_threshold":1.10,"mao_percentage":75,"refinance_ltv_percent":80,"selling_costs_percent":7,"rent_growth_percent":4,"expense_growth_percent":2}'::jsonb),
('system', NULL, 'Wholesale Quick Offer', 'wholesale_quick_offer', 'Fast offer template with editable MAO and assignment fee assumptions.', false, '{"mao_percentage":70,"desired_wholesale_fee":10000,"selling_costs_percent":8}'::jsonb)
ON CONFLICT DO NOTHING;

COMMENT ON TABLE public.market_rent_comps IS 'Comparable rental listings entered manually, imported from files, or later sourced through licensed APIs. Zillow URLs are stored as source references; this table does not require scraping.';
COMMENT ON TABLE public.hud_fmr_cache IS 'Cached HUD USER FMR/SAFMR benchmark rents by ZIP/year. HUD/FMR is a benchmark, not guaranteed contract rent.';
