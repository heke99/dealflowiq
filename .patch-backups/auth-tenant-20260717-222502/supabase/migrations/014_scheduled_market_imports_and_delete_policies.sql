-- DealFlowIQ Batch 12D — scheduled market imports, opportunity ranking threshold, and user-owned deal deletion.
-- Run after 013_market_source_connectors_and_scoring_fix.sql.

create extension if not exists pgcrypto;

-- 1) Market source automation controls.
ALTER TABLE public.market_sources ADD COLUMN IF NOT EXISTS auto_import_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.market_sources ADD COLUMN IF NOT EXISTS schedule_frequency text NOT NULL DEFAULT 'daily';
ALTER TABLE public.market_sources ADD COLUMN IF NOT EXISTS default_visibility text NOT NULL DEFAULT 'private';
ALTER TABLE public.market_sources ADD COLUMN IF NOT EXISTS opportunity_score_threshold numeric(6,2) NOT NULL DEFAULT 80;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'market_sources' AND constraint_name = 'market_sources_schedule_frequency_check'
  ) THEN
    ALTER TABLE public.market_sources DROP CONSTRAINT market_sources_schedule_frequency_check;
  END IF;

  ALTER TABLE public.market_sources
    ADD CONSTRAINT market_sources_schedule_frequency_check
    CHECK (schedule_frequency IN ('hourly', 'twice_daily', 'daily', 'weekly'));
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'market_sources' AND constraint_name = 'market_sources_default_visibility_check'
  ) THEN
    ALTER TABLE public.market_sources DROP CONSTRAINT market_sources_default_visibility_check;
  END IF;

  ALTER TABLE public.market_sources
    ADD CONSTRAINT market_sources_default_visibility_check
    CHECK (default_visibility IN ('private', 'team', 'community', 'public'));
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'market_sources' AND constraint_name = 'market_sources_opportunity_score_threshold_check'
  ) THEN
    ALTER TABLE public.market_sources DROP CONSTRAINT market_sources_opportunity_score_threshold_check;
  END IF;

  ALTER TABLE public.market_sources
    ADD CONSTRAINT market_sources_opportunity_score_threshold_check
    CHECK (opportunity_score_threshold >= 0 AND opportunity_score_threshold <= 100);
END $$;

CREATE INDEX IF NOT EXISTS idx_market_sources_auto_due
ON public.market_sources(auto_import_enabled, status, next_run_at)
WHERE auto_import_enabled = true;

COMMENT ON COLUMN public.market_sources.auto_import_enabled IS 'If true, /api/cron/market-imports can run this source automatically on its schedule.';
COMMENT ON COLUMN public.market_sources.schedule_frequency IS 'hourly/twice_daily/daily/weekly cadence for scheduled source imports.';
COMMENT ON COLUMN public.market_sources.opportunity_score_threshold IS 'Listings with score at or above this threshold are treated as Opportunities. Default 80.';
COMMENT ON COLUMN public.market_sources.settings IS 'Use source_url/source_urls/search_urls for authorized URL imports. Later adapters can store API/feed configuration here.';

-- 2) Import jobs need source_run status to be useful for background workers.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'market_import_jobs' AND constraint_name = 'market_import_jobs_job_type_check'
  ) THEN
    ALTER TABLE public.market_import_jobs DROP CONSTRAINT market_import_jobs_job_type_check;
  END IF;

  ALTER TABLE public.market_import_jobs
    ADD CONSTRAINT market_import_jobs_job_type_check
    CHECK (job_type IN ('manual_url', 'source_run', 'csv_upload', 'api_sync', 'authorized_scrape', 'scheduled_import'));
END $$;

-- 3) Make sure each user can delete their own deals, while admins can delete org deals.
DROP POLICY IF EXISTS deals_delete_owner_admin ON public.deals;
DROP POLICY IF EXISTS deals_delete_admin ON public.deals;
DROP POLICY IF EXISTS deals_delete_owner_admin_creator ON public.deals;
CREATE POLICY deals_delete_owner_admin_creator ON public.deals
FOR DELETE TO authenticated
USING (
  created_by = auth.uid()
  OR assigned_user_id = auth.uid()
  OR public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin'])
  OR public.current_user_is_platform_admin()
);

-- 4) Keep Market cards/ranking fast.
CREATE INDEX IF NOT EXISTS idx_market_listing_scores_listing_calculated
ON public.market_listing_scores(listing_id, calculated_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_listing_scores_score
ON public.market_listing_scores(deal_score DESC, calculated_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_listings_filters
ON public.market_listings(visibility, property_type, state, city, zip_code, created_at DESC);

-- 5) Feature flags for automated source runs and Market surface.
UPDATE public.billing_plans
SET features = COALESCE(features, '{}'::jsonb) || jsonb_build_object(
  'market_opportunities', true,
  'scheduled_market_imports', CASE WHEN code IN ('team_company', 'community_guru', 'white_label', 'enterprise_custom') THEN true ELSE COALESCE((features->>'scheduled_market_imports')::boolean, false) END,
  'market_source_imports', CASE WHEN code IN ('pro_investor', 'team_company', 'community_guru', 'white_label', 'enterprise_custom') THEN true ELSE COALESCE((features->>'market_source_imports')::boolean, false) END,
  'public_community_deals', CASE WHEN code IN ('community_guru', 'white_label', 'enterprise_custom') THEN true ELSE COALESCE((features->>'public_community_deals')::boolean, false) END
),
updated_at = now();
