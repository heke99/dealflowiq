-- DealFlowIQ Batch 12A/12B — Market, Opportunities, public/community deals, images and scoring foundation.
-- Run after 011_smart_rent_delete_market_imports.sql.

create extension if not exists pgcrypto;

-- 1) Feature flags for the new Market/Opportunities product surface.
UPDATE public.billing_plans
SET features = COALESCE(features, '{}'::jsonb) || jsonb_build_object(
  'market_opportunities', true,
  'public_community_deals', CASE WHEN code IN ('team_company', 'community_guru') THEN true ELSE COALESCE((features->>'public_community_deals')::boolean, false) END
),
updated_at = now();

-- 2) Give every deal/listing a first-class image model.
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS primary_image_url text;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS image_urls jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS published_at timestamptz;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS expires_at timestamptz;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'deals'
      AND constraint_name = 'deals_visibility_check'
  ) THEN
    ALTER TABLE public.deals DROP CONSTRAINT deals_visibility_check;
  END IF;

  ALTER TABLE public.deals
    ADD CONSTRAINT deals_visibility_check
    CHECK (visibility IN ('private', 'team', 'community', 'public'));
END $$;

COMMENT ON COLUMN public.deals.primary_image_url IS 'Primary image used on Market cards and deal pages. External images are displayed as source images; later storage upload can replace URL-only input.';
COMMENT ON COLUMN public.deals.image_urls IS 'Optional array of image URLs for galleries/imported listing photos. Avoid republishing images without source rights.';
COMMENT ON COLUMN public.deals.visibility IS 'private/team/community/public visibility for Market and community deal boards.';

CREATE INDEX IF NOT EXISTS idx_deals_visibility_created ON public.deals(visibility, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deals_org_visibility_created ON public.deals(organization_id, visibility, created_at DESC);

-- Keep private/org access and add public read access for published public deals.
DROP POLICY IF EXISTS deals_select_market_public ON public.deals;
CREATE POLICY deals_select_market_public ON public.deals
FOR SELECT TO authenticated
USING (visibility = 'public' AND status NOT IN ('dead', 'rejected'));

-- 3) Market sources replace/extend the earlier source import queue.
CREATE TABLE IF NOT EXISTS public.market_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source_type text NOT NULL DEFAULT 'other' CHECK (source_type IN ('zillow', 'crexi', 'loopnet', 'redfin', 'realtor', 'apartments', 'csv', 'manual_url', 'partner_api', 'mls_feed', 'other')),
  source_name text NOT NULL,
  access_mode text NOT NULL DEFAULT 'manual_url' CHECK (access_mode IN ('authorized_scrape', 'api', 'csv', 'manual_url', 'feed')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'disabled', 'needs_auth', 'failed')),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  rate_limit_per_day integer,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_market_sources_updated_at ON public.market_sources;
CREATE TRIGGER set_market_sources_updated_at
BEFORE UPDATE ON public.market_sources
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.market_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_sources_select_org ON public.market_sources;
CREATE POLICY market_sources_select_org ON public.market_sources
FOR SELECT TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS market_sources_insert_org ON public.market_sources;
CREATE POLICY market_sources_insert_org ON public.market_sources
FOR INSERT TO authenticated
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS market_sources_update_admin ON public.market_sources;
CREATE POLICY market_sources_update_admin ON public.market_sources
FOR UPDATE TO authenticated
USING (public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin())
WITH CHECK (public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS market_sources_delete_admin ON public.market_sources;
CREATE POLICY market_sources_delete_admin ON public.market_sources
FOR DELETE TO authenticated
USING (public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin());

-- 4) Import jobs for source runs/manual URL ingestion.
CREATE TABLE IF NOT EXISTS public.market_import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_id uuid REFERENCES public.market_sources(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  job_type text NOT NULL DEFAULT 'manual_url' CHECK (job_type IN ('manual_url', 'source_run', 'csv_upload', 'api_sync', 'authorized_scrape')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'partial', 'cancelled')),
  input_url text,
  input_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  items_found integer NOT NULL DEFAULT 0,
  items_created integer NOT NULL DEFAULT 0,
  items_updated integer NOT NULL DEFAULT 0,
  items_failed integer NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_market_import_jobs_updated_at ON public.market_import_jobs;
CREATE TRIGGER set_market_import_jobs_updated_at
BEFORE UPDATE ON public.market_import_jobs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.market_import_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_import_jobs_select_org ON public.market_import_jobs;
CREATE POLICY market_import_jobs_select_org ON public.market_import_jobs
FOR SELECT TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS market_import_jobs_insert_org ON public.market_import_jobs;
CREATE POLICY market_import_jobs_insert_org ON public.market_import_jobs
FOR INSERT TO authenticated
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS market_import_jobs_update_admin ON public.market_import_jobs;
CREATE POLICY market_import_jobs_update_admin ON public.market_import_jobs
FOR UPDATE TO authenticated
USING (public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin())
WITH CHECK (public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin());

-- 5) Normalized Market listings.
CREATE TABLE IF NOT EXISTS public.market_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_id uuid REFERENCES public.market_sources(id) ON DELETE SET NULL,
  import_job_id uuid REFERENCES public.market_import_jobs(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source_type text NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual', 'manual_url', 'zillow', 'crexi', 'loopnet', 'redfin', 'realtor', 'apartments', 'csv', 'partner_api', 'mls_feed', 'public_deal', 'community_deal', 'other')),
  external_listing_id text,
  source_url text,
  title text NOT NULL,
  address text,
  city text,
  state text,
  zip_code text,
  county text,
  property_type text,
  units integer DEFAULT 1 CHECK (units IS NULL OR units >= 1),
  bedrooms numeric(6,2),
  bathrooms numeric(6,2),
  sqft integer,
  lot_size text,
  year_built integer,
  list_price numeric(14,2),
  asking_price numeric(14,2),
  arv numeric(14,2),
  rehab_estimate numeric(14,2),
  current_rent numeric(14,2),
  market_rent numeric(14,2),
  hud_rent numeric(14,2),
  estimated_rent numeric(14,2),
  taxes_annual numeric(14,2),
  insurance_annual numeric(14,2),
  hoa_monthly numeric(14,2),
  utilities_monthly numeric(14,2),
  description text,
  broker_name text,
  broker_phone text,
  broker_email text,
  primary_image_url text,
  image_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'team', 'community', 'public')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending_review', 'saved', 'ignored', 'expired', 'converted_to_deal', 'archived')),
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_market_listings_updated_at ON public.market_listings;
CREATE TRIGGER set_market_listings_updated_at
BEFORE UPDATE ON public.market_listings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.market_listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_listings_select_org_or_public ON public.market_listings;
CREATE POLICY market_listings_select_org_or_public ON public.market_listings
FOR SELECT TO authenticated
USING (
  visibility = 'public'
  OR (organization_id IS NOT NULL AND public.current_user_is_org_member(organization_id))
  OR public.current_user_is_platform_admin()
);

DROP POLICY IF EXISTS market_listings_insert_org ON public.market_listings;
CREATE POLICY market_listings_insert_org ON public.market_listings
FOR INSERT TO authenticated
WITH CHECK (
  (organization_id IS NOT NULL AND public.current_user_is_org_member(organization_id))
  OR public.current_user_is_platform_admin()
);

DROP POLICY IF EXISTS market_listings_update_org ON public.market_listings;
CREATE POLICY market_listings_update_org ON public.market_listings
FOR UPDATE TO authenticated
USING ((organization_id IS NOT NULL AND public.current_user_is_org_member(organization_id)) OR public.current_user_is_platform_admin())
WITH CHECK ((organization_id IS NOT NULL AND public.current_user_is_org_member(organization_id)) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS market_listings_delete_admin ON public.market_listings;
CREATE POLICY market_listings_delete_admin ON public.market_listings
FOR DELETE TO authenticated
USING ((organization_id IS NOT NULL AND public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin'])) OR public.current_user_is_platform_admin());

-- 6) Scores are versioned by listing so ranking can improve later without mutating raw listing data.
CREATE TABLE IF NOT EXISTS public.market_listing_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.market_listings(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  formula_version text NOT NULL DEFAULT 'market-score-v1',
  deal_score numeric(6,2) NOT NULL DEFAULT 0 CHECK (deal_score >= 0 AND deal_score <= 100),
  risk_score numeric(6,2) NOT NULL DEFAULT 0 CHECK (risk_score >= 0 AND risk_score <= 100),
  risk_level text NOT NULL DEFAULT 'medium' CHECK (risk_level IN ('low', 'medium', 'high')),
  data_confidence text NOT NULL DEFAULT 'low' CHECK (data_confidence IN ('low', 'medium', 'high')),
  strategy_fit text,
  estimated_noi numeric(14,2),
  estimated_cashflow numeric(14,2),
  estimated_monthly_cashflow numeric(14,2),
  estimated_dscr numeric(10,4),
  estimated_cap_rate numeric(10,6),
  hud_rent numeric(14,2),
  market_rent numeric(14,2),
  rent_gap numeric(14,2),
  hud_rent_gap numeric(14,2),
  break_even_rent numeric(14,2),
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  risks jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.market_listing_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_listing_scores_select_visible ON public.market_listing_scores;
CREATE POLICY market_listing_scores_select_visible ON public.market_listing_scores
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.market_listings ml
    WHERE ml.id = listing_id
      AND (
        ml.visibility = 'public'
        OR (ml.organization_id IS NOT NULL AND public.current_user_is_org_member(ml.organization_id))
        OR public.current_user_is_platform_admin()
      )
  )
);

DROP POLICY IF EXISTS market_listing_scores_insert_org ON public.market_listing_scores;
CREATE POLICY market_listing_scores_insert_org ON public.market_listing_scores
FOR INSERT TO authenticated
WITH CHECK (organization_id IS NULL OR public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

-- 7) Watchlist and user workflow state.
CREATE TABLE IF NOT EXISTS public.market_watchlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES public.market_listings(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'saved' CHECK (status IN ('saved', 'watching', 'ignored', 'converted_to_deal', 'contacted', 'under_contract', 'passed')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, listing_id)
);

DROP TRIGGER IF EXISTS set_market_watchlist_updated_at ON public.market_watchlist;
CREATE TRIGGER set_market_watchlist_updated_at
BEFORE UPDATE ON public.market_watchlist
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.market_watchlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_watchlist_select_own_org ON public.market_watchlist;
CREATE POLICY market_watchlist_select_own_org ON public.market_watchlist
FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS market_watchlist_insert_own ON public.market_watchlist;
CREATE POLICY market_watchlist_insert_own ON public.market_watchlist
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND public.current_user_is_org_member(organization_id));

DROP POLICY IF EXISTS market_watchlist_update_own ON public.market_watchlist;
CREATE POLICY market_watchlist_update_own ON public.market_watchlist
FOR UPDATE TO authenticated
USING (user_id = auth.uid() OR public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin())
WITH CHECK (user_id = auth.uid() OR public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin());

-- 8) Public/community deal posts. A post can point at a deal or a normalized market listing.
CREATE TABLE IF NOT EXISTS public.public_deal_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid REFERENCES public.deals(id) ON DELETE CASCADE,
  listing_id uuid REFERENCES public.market_listings(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('team', 'community', 'public')),
  community_id uuid,
  title text NOT NULL,
  summary text,
  asking_price numeric(14,2),
  assignment_fee numeric(14,2),
  contact_name text,
  contact_email text,
  contact_phone text,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'pending_review', 'published', 'rejected', 'archived', 'expired')),
  expires_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (deal_id IS NOT NULL OR listing_id IS NOT NULL)
);

DROP TRIGGER IF EXISTS set_public_deal_posts_updated_at ON public.public_deal_posts;
CREATE TRIGGER set_public_deal_posts_updated_at
BEFORE UPDATE ON public.public_deal_posts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.public_deal_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS public_deal_posts_select_visible ON public.public_deal_posts;
CREATE POLICY public_deal_posts_select_visible ON public.public_deal_posts
FOR SELECT TO authenticated
USING (
  (visibility = 'public' AND status = 'published')
  OR (organization_id IS NOT NULL AND public.current_user_is_org_member(organization_id))
  OR public.current_user_is_platform_admin()
);

DROP POLICY IF EXISTS public_deal_posts_insert_org ON public.public_deal_posts;
CREATE POLICY public_deal_posts_insert_org ON public.public_deal_posts
FOR INSERT TO authenticated
WITH CHECK (organization_id IS NULL OR public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS public_deal_posts_update_admin ON public.public_deal_posts;
CREATE POLICY public_deal_posts_update_admin ON public.public_deal_posts
FOR UPDATE TO authenticated
USING ((organization_id IS NOT NULL AND public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin'])) OR created_by = auth.uid() OR public.current_user_is_platform_admin())
WITH CHECK ((organization_id IS NOT NULL AND public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin'])) OR created_by = auth.uid() OR public.current_user_is_platform_admin());

-- 9) Indexes for Market filters/sorts.
CREATE INDEX IF NOT EXISTS idx_market_sources_org_type ON public.market_sources(organization_id, source_type, status);
CREATE INDEX IF NOT EXISTS idx_market_import_jobs_org_created ON public.market_import_jobs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_listings_org_created ON public.market_listings(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_listings_visibility_created ON public.market_listings(visibility, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_listings_location ON public.market_listings(state, city, zip_code);
CREATE INDEX IF NOT EXISTS idx_market_listings_property_type ON public.market_listings(property_type);
CREATE INDEX IF NOT EXISTS idx_market_listings_price ON public.market_listings(list_price);
CREATE INDEX IF NOT EXISTS idx_market_listings_source_url ON public.market_listings(source_url) WHERE source_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_market_scores_listing_calc ON public.market_listing_scores(listing_id, calculated_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_scores_score ON public.market_listing_scores(deal_score DESC, calculated_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_watchlist_user_status ON public.market_watchlist(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_deal_posts_visibility_created ON public.public_deal_posts(visibility, status, created_at DESC);

COMMENT ON TABLE public.market_listings IS 'Normalized Market listing feed for imported, public and community deals. Raw source data stays in raw_payload; cards use normalized fields and images.';
COMMENT ON TABLE public.market_listing_scores IS 'DealFlowIQ opportunity scoring results. Scores can be recalculated without mutating raw listing data.';
COMMENT ON TABLE public.public_deal_posts IS 'Public/community deal board posts, similar to a marketplace layer over private deals/listings.';
