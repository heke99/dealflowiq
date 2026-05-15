-- DealFlowIQ Batch 12F + 12G — UX separation, Saved Deals, Buy Boxes and auto discovery foundation.
-- Run after 015_source_worker_v2_market_ui.sql.

create extension if not exists pgcrypto;

-- 1) Buy Boxes: user/team criteria used by the scheduled source worker.
CREATE TABLE IF NOT EXISTS public.market_buy_boxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active',
  city text,
  state text,
  zip_code text,
  county text,
  property_types text[] NOT NULL DEFAULT '{}'::text[],
  strategy text NOT NULL DEFAULT 'buy_hold',
  min_price numeric(14,2),
  max_price numeric(14,2),
  min_units integer,
  max_units integer,
  min_bedrooms numeric(6,2),
  min_bathrooms numeric(6,2),
  min_sqft integer,
  min_deal_score integer NOT NULL DEFAULT 80,
  min_rent_confidence integer NOT NULL DEFAULT 65,
  min_cashflow numeric(14,2),
  min_dscr numeric(10,4),
  min_cap_rate numeric(10,4),
  min_hud_rent_gap numeric(14,2),
  min_market_rent_gap numeric(14,2),
  sources text[] NOT NULL DEFAULT '{}'::text[],
  source_urls text[] NOT NULL DEFAULT '{}'::text[],
  schedule_frequency text NOT NULL DEFAULT 'daily',
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_results_count integer NOT NULL DEFAULT 0,
  last_opportunities_count integer NOT NULL DEFAULT 0,
  last_error text,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT market_buy_boxes_status_check CHECK (status IN ('active', 'paused', 'archived')),
  CONSTRAINT market_buy_boxes_schedule_check CHECK (schedule_frequency IN ('manual', 'hourly', 'twice_daily', 'daily', 'weekly')),
  CONSTRAINT market_buy_boxes_min_score_check CHECK (min_deal_score BETWEEN 0 AND 100),
  CONSTRAINT market_buy_boxes_rent_confidence_check CHECK (min_rent_confidence BETWEEN 0 AND 100)
);

DROP TRIGGER IF EXISTS set_market_buy_boxes_updated_at ON public.market_buy_boxes;
CREATE TRIGGER set_market_buy_boxes_updated_at
BEFORE UPDATE ON public.market_buy_boxes
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.market_buy_boxes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_buy_boxes_select_org ON public.market_buy_boxes;
CREATE POLICY market_buy_boxes_select_org ON public.market_buy_boxes
FOR SELECT TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS market_buy_boxes_insert_org ON public.market_buy_boxes;
CREATE POLICY market_buy_boxes_insert_org ON public.market_buy_boxes
FOR INSERT TO authenticated
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS market_buy_boxes_update_owner_admin ON public.market_buy_boxes;
CREATE POLICY market_buy_boxes_update_owner_admin ON public.market_buy_boxes
FOR UPDATE TO authenticated
USING (created_by = auth.uid() OR public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin())
WITH CHECK (created_by = auth.uid() OR public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin());

-- 2) Connect sources and queue items to Buy Boxes.
ALTER TABLE public.market_sources ADD COLUMN IF NOT EXISTS buy_box_id uuid REFERENCES public.market_buy_boxes(id) ON DELETE SET NULL;
ALTER TABLE public.market_source_queue_items ADD COLUMN IF NOT EXISTS buy_box_id uuid REFERENCES public.market_buy_boxes(id) ON DELETE SET NULL;
ALTER TABLE public.market_import_jobs ADD COLUMN IF NOT EXISTS buy_box_id uuid REFERENCES public.market_buy_boxes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_market_sources_buy_box ON public.market_sources(buy_box_id, status, auto_import_enabled);
CREATE INDEX IF NOT EXISTS idx_market_source_queue_buy_box ON public.market_source_queue_items(buy_box_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_import_jobs_buy_box ON public.market_import_jobs(buy_box_id, created_at DESC);

-- 3) Buy Box matches: listings found for a specific Buy Box.
CREATE TABLE IF NOT EXISTS public.market_buy_box_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  buy_box_id uuid NOT NULL REFERENCES public.market_buy_boxes(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES public.market_listings(id) ON DELETE CASCADE,
  source_id uuid REFERENCES public.market_sources(id) ON DELETE SET NULL,
  deal_score numeric(6,2),
  rent_confidence numeric(6,2),
  matched_status text NOT NULL DEFAULT 'matched',
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  risks jsonb NOT NULL DEFAULT '[]'::jsonb,
  matched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (buy_box_id, listing_id),
  CONSTRAINT market_buy_box_matches_status_check CHECK (matched_status IN ('matched', 'opportunity', 'needs_review', 'ignored', 'expired'))
);

DROP TRIGGER IF EXISTS set_market_buy_box_matches_updated_at ON public.market_buy_box_matches;
CREATE TRIGGER set_market_buy_box_matches_updated_at
BEFORE UPDATE ON public.market_buy_box_matches
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.market_buy_box_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_buy_box_matches_select_org ON public.market_buy_box_matches;
CREATE POLICY market_buy_box_matches_select_org ON public.market_buy_box_matches
FOR SELECT TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS market_buy_box_matches_insert_org ON public.market_buy_box_matches;
CREATE POLICY market_buy_box_matches_insert_org ON public.market_buy_box_matches
FOR INSERT TO authenticated
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS market_buy_box_matches_update_org ON public.market_buy_box_matches;
CREATE POLICY market_buy_box_matches_update_org ON public.market_buy_box_matches
FOR UPDATE TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

-- 4) Better Saved Deals statuses.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'market_watchlist' AND constraint_name = 'market_watchlist_status_check'
  ) THEN
    ALTER TABLE public.market_watchlist DROP CONSTRAINT market_watchlist_status_check;
  END IF;

  ALTER TABLE public.market_watchlist
    ADD CONSTRAINT market_watchlist_status_check
    CHECK (status IN ('saved', 'watching', 'interested', 'contacted', 'analyzing', 'converted_to_deal', 'ignored', 'passed', 'under_contract'));
END $$;

ALTER TABLE public.market_watchlist ADD COLUMN IF NOT EXISTS last_action_at timestamptz NOT NULL DEFAULT now();

-- 5) Listing archive ownership support.
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'market_listings' AND constraint_name = 'market_listings_status_check'
  ) THEN
    ALTER TABLE public.market_listings DROP CONSTRAINT market_listings_status_check;
  END IF;

  ALTER TABLE public.market_listings
    ADD CONSTRAINT market_listings_status_check
    CHECK (status IN ('active', 'opportunity', 'needs_review', 'duplicate', 'archived', 'expired', 'failed_import', 'blocked', 'converted_to_deal'));
END $$;

DROP POLICY IF EXISTS market_listings_delete_owner_admin ON public.market_listings;
CREATE POLICY market_listings_delete_owner_admin ON public.market_listings
FOR DELETE TO authenticated
USING (created_by = auth.uid() OR public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin());

-- 6) Indexes for UX pages and worker.
CREATE INDEX IF NOT EXISTS idx_market_buy_boxes_org_status ON public.market_buy_boxes(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_buy_boxes_due ON public.market_buy_boxes(status, next_run_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_market_buy_box_matches_score ON public.market_buy_box_matches(buy_box_id, deal_score DESC, matched_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_listings_status_created ON public.market_listings(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_watchlist_user_listing ON public.market_watchlist(user_id, listing_id);

-- 7) Feature flags for plans that should expose Buy Boxes and scheduled discovery.
UPDATE public.billing_plans
SET features = COALESCE(features, '{}'::jsonb) || jsonb_build_object(
  'market_opportunities', true,
  'market_source_imports', CASE WHEN code IN ('pro_investor', 'team_company', 'community_guru', 'white_label', 'enterprise_custom') THEN true ELSE COALESCE((features->>'market_source_imports')::boolean, false) END,
  'scheduled_market_imports', CASE WHEN code IN ('team_company', 'community_guru', 'white_label', 'enterprise_custom') THEN true ELSE COALESCE((features->>'scheduled_market_imports')::boolean, false) END,
  'public_community_deals', CASE WHEN code IN ('community_guru', 'white_label', 'enterprise_custom') THEN true ELSE COALESCE((features->>'public_community_deals')::boolean, false) END
),
updated_at = now();

COMMENT ON TABLE public.market_buy_boxes IS 'User/team investment criteria. Scheduled sources use Buy Boxes to discover listings automatically and rank only strong matches into Opportunities.';
COMMENT ON TABLE public.market_buy_box_matches IS 'Join table between Buy Boxes and Market listings found by source runs, with score and match status.';
COMMENT ON COLUMN public.market_watchlist.last_action_at IS 'Timestamp for the latest user workflow action on a saved deal/opportunity.';
