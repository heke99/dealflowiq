-- DealFlowIQ Batch 12G.2 + 12H — Opportunity quality gates, Buy Box criteria matching and Buyer CRM/matching.
-- Run after 016_buy_boxes_saved_deals_market_ux.sql.

create extension if not exists pgcrypto;

-- 1) Stronger scoring metadata. Opportunities should be score-qualified AND rent-confidence-qualified.
ALTER TABLE public.market_listing_scores ADD COLUMN IF NOT EXISTS data_confidence_score numeric(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.market_listing_scores ADD COLUMN IF NOT EXISTS rent_confidence_score numeric(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.market_listing_scores ADD COLUMN IF NOT EXISTS source_confidence_score numeric(6,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'market_listing_scores' AND constraint_name = 'market_listing_scores_data_confidence_score_check'
  ) THEN
    ALTER TABLE public.market_listing_scores
      ADD CONSTRAINT market_listing_scores_data_confidence_score_check CHECK (data_confidence_score >= 0 AND data_confidence_score <= 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'market_listing_scores' AND constraint_name = 'market_listing_scores_rent_confidence_score_check'
  ) THEN
    ALTER TABLE public.market_listing_scores
      ADD CONSTRAINT market_listing_scores_rent_confidence_score_check CHECK (rent_confidence_score >= 0 AND rent_confidence_score <= 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'market_listing_scores' AND constraint_name = 'market_listing_scores_source_confidence_score_check'
  ) THEN
    ALTER TABLE public.market_listing_scores
      ADD CONSTRAINT market_listing_scores_source_confidence_score_check CHECK (source_confidence_score >= 0 AND source_confidence_score <= 100);
  END IF;
END $$;

UPDATE public.market_listing_scores
SET
  data_confidence_score = CASE data_confidence WHEN 'high' THEN 85 WHEN 'medium' THEN 65 ELSE 35 END,
  rent_confidence_score = CASE
    WHEN COALESCE(hud_rent, 0) > 0 AND COALESCE(market_rent, 0) > 0 THEN 85
    WHEN COALESCE(hud_rent, 0) > 0 OR COALESCE(market_rent, 0) > 0 THEN 70
    WHEN COALESCE(break_even_rent, 0) > 0 THEN 45
    ELSE 25
  END,
  source_confidence_score = CASE data_confidence WHEN 'high' THEN 80 WHEN 'medium' THEN 60 ELSE 35 END
WHERE data_confidence_score = 0 OR rent_confidence_score = 0 OR source_confidence_score = 0;

CREATE INDEX IF NOT EXISTS idx_market_scores_opportunity_quality
ON public.market_listing_scores(deal_score DESC, rent_confidence_score DESC, calculated_at DESC)
WHERE deal_score >= 80 AND rent_confidence_score >= 65;

COMMENT ON COLUMN public.market_listing_scores.rent_confidence_score IS '0-100 confidence that rent inputs are usable enough to promote a listing from Market to Opportunities.';
COMMENT ON COLUMN public.market_listing_scores.data_confidence_score IS '0-100 source/data completeness confidence for Market scoring.';
COMMENT ON COLUMN public.market_listing_scores.source_confidence_score IS '0-100 confidence in imported/source-derived fields.';

-- 2) Improve Buy Box matches with criteria snapshots and true match score.
ALTER TABLE public.market_buy_box_matches ADD COLUMN IF NOT EXISTS match_score numeric(6,2) NOT NULL DEFAULT 0;
ALTER TABLE public.market_buy_box_matches ADD COLUMN IF NOT EXISTS criteria_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.market_buy_box_matches ADD COLUMN IF NOT EXISTS rent_confidence_score numeric(6,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_market_buy_box_matches_status_score
ON public.market_buy_box_matches(buy_box_id, matched_status, match_score DESC, deal_score DESC, matched_at DESC);

COMMENT ON COLUMN public.market_buy_box_matches.match_score IS '0-100 fit between Buy Box criteria and imported listing. Different from underwriting deal_score.';
COMMENT ON COLUMN public.market_buy_box_matches.criteria_snapshot IS 'Snapshot of Buy Box criteria and pass/fail reasons at match time.';


-- 2b) Keep source archiving valid for Buy Box archive flows.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'market_sources' AND constraint_name = 'market_sources_status_check'
  ) THEN
    ALTER TABLE public.market_sources DROP CONSTRAINT market_sources_status_check;
  END IF;

  ALTER TABLE public.market_sources
    ADD CONSTRAINT market_sources_status_check
    CHECK (status IN ('active', 'paused', 'disabled', 'needs_auth', 'failed', 'archived'));
END $$;

-- 3) Buyer CRM.
CREATE TABLE IF NOT EXISTS public.buyers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  buyer_type text NOT NULL DEFAULT 'investor',
  status text NOT NULL DEFAULT 'active',
  relationship_stage text NOT NULL DEFAULT 'new',
  source text,
  name text NOT NULL,
  company_name text,
  email text,
  phone text,
  financing_type text,
  proof_of_funds_status text NOT NULL DEFAULT 'unknown',
  min_budget numeric(14,2),
  max_budget numeric(14,2),
  preferred_states text[] NOT NULL DEFAULT '{}'::text[],
  preferred_cities text[] NOT NULL DEFAULT '{}'::text[],
  preferred_zip_codes text[] NOT NULL DEFAULT '{}'::text[],
  property_types text[] NOT NULL DEFAULT '{}'::text[],
  strategies text[] NOT NULL DEFAULT '{}'::text[],
  min_units integer,
  max_units integer,
  min_bedrooms numeric(6,2),
  min_bathrooms numeric(6,2),
  min_sqft integer,
  min_cashflow numeric(14,2),
  min_dscr numeric(10,4),
  min_cap_rate numeric(10,6),
  min_arv_spread numeric(14,2),
  notes text,
  tags text[] NOT NULL DEFAULT '{}'::text[],
  last_contacted_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT buyers_status_check CHECK (status IN ('active', 'warm', 'hot', 'paused', 'archived')),
  CONSTRAINT buyers_stage_check CHECK (relationship_stage IN ('new', 'qualified', 'sent_deals', 'offer_made', 'closed', 'nurture')),
  CONSTRAINT buyers_type_check CHECK (buyer_type IN ('investor', 'landlord', 'flipper', 'wholesaler', 'fund', 'agent', 'other')),
  CONSTRAINT buyers_pof_check CHECK (proof_of_funds_status IN ('unknown', 'requested', 'received', 'verified', 'expired'))
);

DROP TRIGGER IF EXISTS set_buyers_updated_at ON public.buyers;
CREATE TRIGGER set_buyers_updated_at
BEFORE UPDATE ON public.buyers
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.buyers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS buyers_select_org ON public.buyers;
CREATE POLICY buyers_select_org ON public.buyers
FOR SELECT TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS buyers_insert_org ON public.buyers;
CREATE POLICY buyers_insert_org ON public.buyers
FOR INSERT TO authenticated
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS buyers_update_org ON public.buyers;
CREATE POLICY buyers_update_org ON public.buyers
FOR UPDATE TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS buyers_delete_admin ON public.buyers;
CREATE POLICY buyers_delete_admin ON public.buyers
FOR DELETE TO authenticated
USING (public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin());

CREATE INDEX IF NOT EXISTS idx_buyers_org_status ON public.buyers(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_buyers_org_stage ON public.buyers(organization_id, relationship_stage, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_buyers_assigned ON public.buyers(assigned_user_id, status, updated_at DESC);

-- 4) Buyer-to-listing/deal matches. This powers Buyers, Opportunities and future deal distribution.
CREATE TABLE IF NOT EXISTS public.buyer_deal_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  buyer_id uuid NOT NULL REFERENCES public.buyers(id) ON DELETE CASCADE,
  listing_id uuid REFERENCES public.market_listings(id) ON DELETE CASCADE,
  deal_id uuid REFERENCES public.deals(id) ON DELETE CASCADE,
  match_score numeric(6,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'auto_matched',
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  risks jsonb NOT NULL DEFAULT '[]'::jsonb,
  matched_at timestamptz NOT NULL DEFAULT now(),
  last_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT buyer_deal_matches_target_check CHECK (listing_id IS NOT NULL OR deal_id IS NOT NULL),
  CONSTRAINT buyer_deal_matches_status_check CHECK (status IN ('auto_matched', 'review', 'sent', 'interested', 'not_interested', 'offer_made', 'closed', 'archived')),
  CONSTRAINT buyer_deal_matches_score_check CHECK (match_score >= 0 AND match_score <= 100)
);

DROP TRIGGER IF EXISTS set_buyer_deal_matches_updated_at ON public.buyer_deal_matches;
CREATE TRIGGER set_buyer_deal_matches_updated_at
BEFORE UPDATE ON public.buyer_deal_matches
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.buyer_deal_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS buyer_deal_matches_select_org ON public.buyer_deal_matches;
CREATE POLICY buyer_deal_matches_select_org ON public.buyer_deal_matches
FOR SELECT TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS buyer_deal_matches_insert_org ON public.buyer_deal_matches;
CREATE POLICY buyer_deal_matches_insert_org ON public.buyer_deal_matches
FOR INSERT TO authenticated
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS buyer_deal_matches_update_org ON public.buyer_deal_matches;
CREATE POLICY buyer_deal_matches_update_org ON public.buyer_deal_matches
FOR UPDATE TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

CREATE UNIQUE INDEX IF NOT EXISTS idx_buyer_deal_matches_unique_listing
ON public.buyer_deal_matches(buyer_id, listing_id)
WHERE listing_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_buyer_deal_matches_unique_deal
ON public.buyer_deal_matches(buyer_id, deal_id)
WHERE deal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_buyer_deal_matches_org_score
ON public.buyer_deal_matches(organization_id, status, match_score DESC, matched_at DESC);

-- 5) Buyer notes / contact log.
CREATE TABLE IF NOT EXISTS public.buyer_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  buyer_id uuid NOT NULL REFERENCES public.buyers(id) ON DELETE CASCADE,
  listing_id uuid REFERENCES public.market_listings(id) ON DELETE SET NULL,
  deal_id uuid REFERENCES public.deals(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  interaction_type text NOT NULL DEFAULT 'note',
  direction text NOT NULL DEFAULT 'internal',
  summary text NOT NULL,
  next_follow_up_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT buyer_interactions_type_check CHECK (interaction_type IN ('note', 'call', 'email', 'sms', 'meeting', 'deal_sent', 'offer', 'follow_up')),
  CONSTRAINT buyer_interactions_direction_check CHECK (direction IN ('internal', 'outbound', 'inbound'))
);

ALTER TABLE public.buyer_interactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS buyer_interactions_select_org ON public.buyer_interactions;
CREATE POLICY buyer_interactions_select_org ON public.buyer_interactions
FOR SELECT TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS buyer_interactions_insert_org ON public.buyer_interactions;
CREATE POLICY buyer_interactions_insert_org ON public.buyer_interactions
FOR INSERT TO authenticated
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

CREATE INDEX IF NOT EXISTS idx_buyer_interactions_buyer_created ON public.buyer_interactions(buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_buyer_interactions_followup ON public.buyer_interactions(organization_id, next_follow_up_at) WHERE next_follow_up_at IS NOT NULL;

-- 6) Ensure plans that should have disposition tooling get it.
UPDATE public.billing_plans
SET features = COALESCE(features, '{}'::jsonb) || jsonb_build_object(
  'buyers', CASE WHEN code IN ('wholesaler', 'team_company', 'community_guru', 'white_label', 'enterprise_custom') THEN true ELSE COALESCE((features->>'buyers')::boolean, false) END,
  'buyer_matching', CASE WHEN code IN ('wholesaler', 'team_company', 'community_guru', 'white_label', 'enterprise_custom') THEN true ELSE COALESCE((features->>'buyer_matching')::boolean, false) END,
  'deal_distribution', CASE WHEN code IN ('wholesaler', 'community_guru', 'white_label', 'enterprise_custom') THEN true ELSE COALESCE((features->>'deal_distribution')::boolean, false) END
),
updated_at = now();

COMMENT ON TABLE public.buyers IS 'Buyer CRM for dispositions: investors, landlords, flippers, funds and agents with criteria used by buyer matching.';
COMMENT ON TABLE public.buyer_deal_matches IS 'Computed buyer-to-market-listing/deal fit. Review these before sending deals to buyers.';
COMMENT ON TABLE public.buyer_interactions IS 'Buyer contact log and follow-up history.';
