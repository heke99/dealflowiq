-- DealFlowIQ Batch 12E — Source Worker v2, queue handling, listing detail support and Market UI polish.
-- Run after 014_scheduled_market_imports_and_delete_policies.sql.

create extension if not exists pgcrypto;

-- 1) Source Worker v2 queue: each source can keep a backlog of URLs/feed items.
CREATE TABLE IF NOT EXISTS public.market_source_queue_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES public.market_sources(id) ON DELETE CASCADE,
  listing_id uuid REFERENCES public.market_listings(id) ON DELETE SET NULL,
  input_url text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  priority integer NOT NULL DEFAULT 50,
  attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  completed_at timestamptz,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT market_source_queue_items_status_check CHECK (status IN ('queued', 'running', 'completed', 'failed', 'ignored'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_market_source_queue_unique_url
ON public.market_source_queue_items(source_id, input_url);

CREATE INDEX IF NOT EXISTS idx_market_source_queue_due
ON public.market_source_queue_items(source_id, status, priority DESC, next_attempt_at, created_at)
WHERE status IN ('queued', 'failed');

DROP TRIGGER IF EXISTS set_market_source_queue_items_updated_at ON public.market_source_queue_items;
CREATE TRIGGER set_market_source_queue_items_updated_at
BEFORE UPDATE ON public.market_source_queue_items
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.market_source_queue_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_source_queue_items_select_org ON public.market_source_queue_items;
CREATE POLICY market_source_queue_items_select_org ON public.market_source_queue_items
FOR SELECT TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS market_source_queue_items_insert_org ON public.market_source_queue_items;
CREATE POLICY market_source_queue_items_insert_org ON public.market_source_queue_items
FOR INSERT TO authenticated
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS market_source_queue_items_update_admin ON public.market_source_queue_items;
CREATE POLICY market_source_queue_items_update_admin ON public.market_source_queue_items
FOR UPDATE TO authenticated
USING (public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin())
WITH CHECK (public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin());

-- 2) Make connector metadata explicit on sources and jobs.
ALTER TABLE public.market_sources ADD COLUMN IF NOT EXISTS adapter_key text;
ALTER TABLE public.market_sources ADD COLUMN IF NOT EXISTS last_success_at timestamptz;
ALTER TABLE public.market_sources ADD COLUMN IF NOT EXISTS last_failure_at timestamptz;
ALTER TABLE public.market_sources ADD COLUMN IF NOT EXISTS last_error text;

ALTER TABLE public.market_import_jobs ADD COLUMN IF NOT EXISTS normalized_listing_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.market_import_jobs ADD COLUMN IF NOT EXISTS source_summary jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON TABLE public.market_source_queue_items IS 'Source Worker v2 queue. Auto sources seed URLs here; cron picks queued items, imports, scores, and updates Market/Opportunities.';
COMMENT ON COLUMN public.market_sources.adapter_key IS 'Explicit adapter key such as zillow, crexi, loopnet. Keeps source-specific parsing behavior separated from the generic pipeline.';

-- 3) Better source constraints: allow current and next connector types.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'market_sources' AND constraint_name = 'market_sources_source_type_check'
  ) THEN
    ALTER TABLE public.market_sources DROP CONSTRAINT market_sources_source_type_check;
  END IF;

  ALTER TABLE public.market_sources
    ADD CONSTRAINT market_sources_source_type_check
    CHECK (source_type IN ('zillow', 'crexi', 'loopnet', 'redfin', 'realtor', 'apartments', 'csv', 'manual_url', 'partner_api', 'mls_feed', 'manual', 'other'));
END $$;

-- 4) Public/community features and source worker stay premium-enabled on relevant plans.
UPDATE public.billing_plans
SET features = COALESCE(features, '{}'::jsonb) || jsonb_build_object(
  'market_opportunities', true,
  'market_source_imports', CASE WHEN code IN ('pro_investor', 'team_company', 'community_guru', 'white_label', 'enterprise_custom') THEN true ELSE COALESCE((features->>'market_source_imports')::boolean, false) END,
  'scheduled_market_imports', CASE WHEN code IN ('team_company', 'community_guru', 'white_label', 'enterprise_custom') THEN true ELSE COALESCE((features->>'scheduled_market_imports')::boolean, false) END,
  'public_community_deals', CASE WHEN code IN ('community_guru', 'white_label', 'enterprise_custom') THEN true ELSE COALESCE((features->>'public_community_deals')::boolean, false) END
),
updated_at = now();
