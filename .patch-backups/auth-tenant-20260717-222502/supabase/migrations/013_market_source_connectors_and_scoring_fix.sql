-- DealFlowIQ Batch 12C — source connector pipeline, safer scoring constraints and public/community publishing polish.
-- Run after 012_market_opportunities_core.sql.

create extension if not exists pgcrypto;

-- 1) Ensure premium feature flags exist for source imports and public/community deal boards.
UPDATE public.billing_plans
SET features = COALESCE(features, '{}'::jsonb) || jsonb_build_object(
  'market_opportunities', true,
  'market_source_imports', CASE WHEN code IN ('pro_investor', 'team_company', 'community_guru', 'white_label', 'enterprise_custom') THEN true ELSE COALESCE((features->>'market_source_imports')::boolean, false) END,
  'public_community_deals', CASE WHEN code IN ('community_guru', 'white_label', 'enterprise_custom') THEN true ELSE COALESCE((features->>'public_community_deals')::boolean, false) END
),
updated_at = now();

-- 2) Repair older Batch 12 constraints so manual_url connectors and all expected source types are accepted.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'market_listings' AND constraint_name = 'market_listings_source_type_check'
  ) THEN
    ALTER TABLE public.market_listings DROP CONSTRAINT market_listings_source_type_check;
  END IF;

  ALTER TABLE public.market_listings
    ADD CONSTRAINT market_listings_source_type_check
    CHECK (source_type IN ('manual', 'manual_url', 'zillow', 'crexi', 'loopnet', 'redfin', 'realtor', 'apartments', 'csv', 'partner_api', 'mls_feed', 'public_deal', 'community_deal', 'other'));
END $$;

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
    CHECK (source_type IN ('zillow', 'crexi', 'loopnet', 'redfin', 'realtor', 'apartments', 'csv', 'manual_url', 'partner_api', 'mls_feed', 'other'));
END $$;

-- 3) Add connector/debug metadata columns without breaking existing rows.
ALTER TABLE public.market_sources ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE public.market_sources ADD COLUMN IF NOT EXISTS last_success_at timestamptz;
ALTER TABLE public.market_sources ADD COLUMN IF NOT EXISTS last_failure_at timestamptz;
ALTER TABLE public.market_import_jobs ADD COLUMN IF NOT EXISTS normalized_listing_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.market_import_jobs ADD COLUMN IF NOT EXISTS source_summary jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.market_import_jobs.normalized_listing_ids IS 'Listings created/updated by this import job. Used to audit URL/CSV/API imports.';
COMMENT ON COLUMN public.market_import_jobs.source_summary IS 'Connector metadata such as detected source, parser confidence, blocked fetch status, and source field coverage.';

-- 4) Indexes for dedupe/import performance.
CREATE INDEX IF NOT EXISTS idx_market_listings_org_external ON public.market_listings(organization_id, source_type, external_listing_id) WHERE external_listing_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_market_listings_import_job ON public.market_listings(import_job_id);
CREATE INDEX IF NOT EXISTS idx_market_import_jobs_source_status ON public.market_import_jobs(source_id, status, created_at DESC);

-- 5) Comments to lock the product rule.
COMMENT ON TABLE public.market_sources IS 'Configured source connectors. Source access must be authorized: API, CSV/feed, manual URL, or approved scrape. Raw imports normalize into market_listings.';
COMMENT ON TABLE public.market_import_jobs IS 'Auditable source import jobs. Failed jobs are kept visible so bad source data never silently pollutes Market or Opportunities.';
