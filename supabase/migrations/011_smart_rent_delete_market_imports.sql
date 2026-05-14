-- DealFlowIQ Batch 6.2 — Smart rent UX, deletable deals, and premium market source imports.
-- Run after 010_hud_zillow_analyzer_production_fix.sql.

create extension if not exists pgcrypto;

-- 1) Premium feature flag for automated market source imports.
UPDATE public.billing_plans
SET features = COALESCE(features, '{}'::jsonb) || jsonb_build_object(
  'market_source_imports', CASE WHEN code IN ('team_company', 'community_guru') THEN true ELSE COALESCE((features->>'market_source_imports')::boolean, false) END
),
updated_at = now();

-- Give platform/admin overrides room to use it too; app code still respects plan/features.
COMMENT ON TABLE public.billing_plans IS 'Billing/access plans. market_source_imports gates premium listing/source ingestion from authorized sources such as Zillow, Crexi, CSV, or licensed APIs.';

-- 2) Make deal deletion possible for owners/admins and platform admins.
DROP POLICY IF EXISTS deals_delete_admin ON public.deals;
CREATE POLICY deals_delete_admin ON public.deals
FOR DELETE TO authenticated
USING (
  public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin'])
  OR created_by = auth.uid()
  OR public.current_user_is_platform_admin()
);

-- 3) Marketplace/source import queue. This is intentionally source/audit first.
CREATE TABLE IF NOT EXISTS public.market_source_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source_type text NOT NULL DEFAULT 'other' CHECK (source_type IN ('zillow', 'crexi', 'apartments', 'realtor', 'redfin', 'csv', 'licensed_api', 'other')),
  source_url text,
  search_market text,
  search_zip text,
  property_type text,
  strategy text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'imported', 'needs_review', 'failed', 'ignored')),
  imported_count integer NOT NULL DEFAULT 0 CHECK (imported_count >= 0),
  best_score numeric(8,3),
  notes text,
  error_message text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_market_source_imports_updated_at ON public.market_source_imports;
CREATE TRIGGER set_market_source_imports_updated_at
BEFORE UPDATE ON public.market_source_imports
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.market_source_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_source_imports_select_org ON public.market_source_imports;
CREATE POLICY market_source_imports_select_org ON public.market_source_imports
FOR SELECT TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS market_source_imports_insert_org ON public.market_source_imports;
CREATE POLICY market_source_imports_insert_org ON public.market_source_imports
FOR INSERT TO authenticated
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS market_source_imports_update_admin ON public.market_source_imports;
CREATE POLICY market_source_imports_update_admin ON public.market_source_imports
FOR UPDATE TO authenticated
USING (public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin())
WITH CHECK (public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS market_source_imports_delete_admin ON public.market_source_imports;
CREATE POLICY market_source_imports_delete_admin ON public.market_source_imports
FOR DELETE TO authenticated
USING (public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin());

CREATE INDEX IF NOT EXISTS idx_market_source_imports_org_created ON public.market_source_imports(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_source_imports_org_status ON public.market_source_imports(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_source_imports_source_url ON public.market_source_imports(source_url) WHERE source_url IS NOT NULL;

COMMENT ON TABLE public.market_source_imports IS
'Premium source-ingestion queue for authorized listing/market sources. Source records are stored for review/audit before becoming deals or market comps.';

-- 4) Keep market comps compatible with source imports.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'market_rent_comps'
      AND constraint_name = 'market_rent_comps_source_type_check'
  ) THEN
    ALTER TABLE public.market_rent_comps DROP CONSTRAINT market_rent_comps_source_type_check;
  END IF;

  ALTER TABLE public.market_rent_comps
    ADD CONSTRAINT market_rent_comps_source_type_check
    CHECK (source_type IN ('manual', 'zillow_url', 'crexi_url', 'licensed_api', 'csv_upload', 'pdf_upload', 'ai_extracted', 'other'));
END $$;
