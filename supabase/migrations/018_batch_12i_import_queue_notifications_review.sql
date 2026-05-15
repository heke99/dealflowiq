-- DealFlowIQ Batch 12I — URL Import Analyzer, in-app notifications, review workflow, notes and activity.
-- Run after 017_batch_12g2_12h_buyers_matching_quality.sql.

create extension if not exists pgcrypto;

-- 1) In-app notifications only. No email/SMS distribution is created in this batch.
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  type text NOT NULL DEFAULT 'system',
  title text NOT NULL,
  message text NOT NULL,
  related_entity_type text,
  related_entity_id uuid,
  action_href text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_type_check CHECK (type IN (
    'system',
    'import_analyzed',
    'import_completed',
    'import_failed',
    'opportunity_found',
    'buyer_match',
    'saved_deal_score_changed',
    'buy_box_run_completed',
    'rent_confidence_review',
    'deal_note_added',
    'deal_status_changed'
  ))
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select_org_user ON public.notifications;
CREATE POLICY notifications_select_org_user ON public.notifications
FOR SELECT TO authenticated
USING (
  (public.current_user_is_org_member(organization_id) AND (user_id IS NULL OR user_id = auth.uid()))
  OR public.current_user_is_platform_admin()
);

DROP POLICY IF EXISTS notifications_insert_org ON public.notifications;
CREATE POLICY notifications_insert_org ON public.notifications
FOR INSERT TO authenticated
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own ON public.notifications
FOR UPDATE TO authenticated
USING (
  (public.current_user_is_org_member(organization_id) AND (user_id IS NULL OR user_id = auth.uid()))
  OR public.current_user_is_platform_admin()
)
WITH CHECK (
  (public.current_user_is_org_member(organization_id) AND (user_id IS NULL OR user_id = auth.uid()))
  OR public.current_user_is_platform_admin()
);

CREATE INDEX IF NOT EXISTS idx_notifications_org_user_unread ON public.notifications(organization_id, user_id, created_at DESC) WHERE read_at IS NULL AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_org_created ON public.notifications(organization_id, created_at DESC);
COMMENT ON TABLE public.notifications IS 'In-app notification center. Email/SMS distribution is intentionally not implemented in Batch 12I.';
COMMENT ON COLUMN public.notifications.action_href IS 'Internal app link such as /market/:id or /imports. Not an external email/SMS action.';

-- 2) URL Import Analyzer queue. Stores search URLs/search metadata without requiring scraping result pages.
CREATE TABLE IF NOT EXISTS public.market_url_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source_id uuid REFERENCES public.market_sources(id) ON DELETE SET NULL,
  source_type text NOT NULL DEFAULT 'manual_url',
  import_mode text NOT NULL DEFAULT 'search_url',
  status text NOT NULL DEFAULT 'analyzed',
  input_url text NOT NULL,
  normalized_url text,
  source_name text,
  title text NOT NULL,
  summary text,
  target_city text,
  target_state text,
  target_zip text,
  min_price numeric(14,2),
  max_price numeric(14,2),
  map_bounds jsonb,
  parsed_query jsonb NOT NULL DEFAULT '{}'::jsonb,
  queue_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  visibility text NOT NULL DEFAULT 'private',
  last_error text,
  reviewed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT market_url_import_batches_source_type_check CHECK (source_type IN ('manual', 'manual_url', 'zillow', 'crexi', 'loopnet', 'redfin', 'realtor', 'apartments', 'csv', 'partner_api', 'mls_feed', 'public_deal', 'community_deal', 'other')),
  CONSTRAINT market_url_import_batches_import_mode_check CHECK (import_mode IN ('search_url', 'listing_url', 'csv', 'feed', 'api')),
  CONSTRAINT market_url_import_batches_status_check CHECK (status IN ('analyzed', 'queued', 'importing', 'completed', 'needs_review', 'failed', 'cancelled')),
  CONSTRAINT market_url_import_batches_visibility_check CHECK (visibility IN ('private', 'team', 'community', 'public'))
);

DROP TRIGGER IF EXISTS set_market_url_import_batches_updated_at ON public.market_url_import_batches;
CREATE TRIGGER set_market_url_import_batches_updated_at
BEFORE UPDATE ON public.market_url_import_batches
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.market_url_import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_url_import_batches_select_org ON public.market_url_import_batches;
CREATE POLICY market_url_import_batches_select_org ON public.market_url_import_batches
FOR SELECT TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS market_url_import_batches_insert_org ON public.market_url_import_batches;
CREATE POLICY market_url_import_batches_insert_org ON public.market_url_import_batches
FOR INSERT TO authenticated
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS market_url_import_batches_update_org ON public.market_url_import_batches;
CREATE POLICY market_url_import_batches_update_org ON public.market_url_import_batches
FOR UPDATE TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

CREATE INDEX IF NOT EXISTS idx_market_url_import_batches_org_status ON public.market_url_import_batches(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_url_import_batches_location ON public.market_url_import_batches(organization_id, target_state, target_city, target_zip, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_url_import_batches_url ON public.market_url_import_batches(organization_id, normalized_url);

COMMENT ON TABLE public.market_url_import_batches IS 'Analyzed authorized source/search URLs. Search URLs become import queue batches; listing creation still happens through listing URL, CSV/API/feed, or approved provider output.';

-- 3) Deal review status on Market listings.
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS deal_status text NOT NULL DEFAULT 'needs_review';
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS review_reason text;
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS why_this_deal text;
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS last_reviewed_at timestamptz;
ALTER TABLE public.market_listings ADD COLUMN IF NOT EXISTS last_reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'market_listings' AND constraint_name = 'market_listings_deal_status_check'
  ) THEN
    ALTER TABLE public.market_listings DROP CONSTRAINT market_listings_deal_status_check;
  END IF;

  ALTER TABLE public.market_listings
    ADD CONSTRAINT market_listings_deal_status_check
    CHECK (deal_status IN ('ready', 'needs_review', 'missing_data', 'low_confidence', 'archived'));
END $$;

UPDATE public.market_listings ml
SET deal_status = CASE
  WHEN ml.status = 'archived' THEN 'archived'
  WHEN COALESCE(ms.deal_score, 0) >= 80 AND COALESCE(ms.rent_confidence_score, 0) >= 65 THEN 'ready'
  WHEN COALESCE(ms.deal_score, 0) >= 70 AND COALESCE(ms.rent_confidence_score, 0) < 65 THEN 'low_confidence'
  ELSE 'needs_review'
END,
review_reason = COALESCE(review_reason, 'Backfilled from latest score during Batch 12I.')
FROM (
  SELECT DISTINCT ON (listing_id) listing_id, deal_score, rent_confidence_score
  FROM public.market_listing_scores
  ORDER BY listing_id, calculated_at DESC
) ms
WHERE ms.listing_id = ml.id;

CREATE INDEX IF NOT EXISTS idx_market_listings_deal_status ON public.market_listings(organization_id, deal_status, updated_at DESC);

-- 4) Deal notes / internal comments.
CREATE TABLE IF NOT EXISTS public.market_listing_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES public.market_listings(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note text NOT NULL,
  note_type text NOT NULL DEFAULT 'internal',
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT market_listing_notes_note_type_check CHECK (note_type IN ('internal', 'seller_call', 'buyer_feedback', 'underwriting', 'offer', 'risk'))
);

DROP TRIGGER IF EXISTS set_market_listing_notes_updated_at ON public.market_listing_notes;
CREATE TRIGGER set_market_listing_notes_updated_at
BEFORE UPDATE ON public.market_listing_notes
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.market_listing_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_listing_notes_select_org ON public.market_listing_notes;
CREATE POLICY market_listing_notes_select_org ON public.market_listing_notes
FOR SELECT TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS market_listing_notes_insert_org ON public.market_listing_notes;
CREATE POLICY market_listing_notes_insert_org ON public.market_listing_notes
FOR INSERT TO authenticated
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS market_listing_notes_update_org ON public.market_listing_notes;
CREATE POLICY market_listing_notes_update_org ON public.market_listing_notes
FOR UPDATE TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS market_listing_notes_delete_admin ON public.market_listing_notes;
CREATE POLICY market_listing_notes_delete_admin ON public.market_listing_notes
FOR DELETE TO authenticated
USING (public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin());

CREATE INDEX IF NOT EXISTS idx_market_listing_notes_listing ON public.market_listing_notes(listing_id, created_at DESC);

-- 5) Activity timeline on listing/deal.
CREATE TABLE IF NOT EXISTS public.market_listing_activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES public.market_listings(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  title text NOT NULL,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT market_listing_activity_events_type_check CHECK (event_type IN (
    'imported',
    'score_calculated',
    'buyer_matched',
    'watchlist_saved',
    'note_added',
    'status_changed',
    'marked_opportunity',
    'converted_to_deal',
    'review_updated'
  ))
);

ALTER TABLE public.market_listing_activity_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_listing_activity_select_org ON public.market_listing_activity_events;
CREATE POLICY market_listing_activity_select_org ON public.market_listing_activity_events
FOR SELECT TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS market_listing_activity_insert_org ON public.market_listing_activity_events;
CREATE POLICY market_listing_activity_insert_org ON public.market_listing_activity_events
FOR INSERT TO authenticated
WITH CHECK (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

CREATE INDEX IF NOT EXISTS idx_market_listing_activity_listing ON public.market_listing_activity_events(listing_id, created_at DESC);

-- 6) Feature flag for import queue UI. This is still in-app only.
UPDATE public.billing_plans
SET features = COALESCE(features, '{}'::jsonb) || jsonb_build_object(
  'market_opportunities', true,
  'market_source_imports', CASE WHEN code IN ('pro_investor', 'team_company', 'community_guru', 'white_label', 'enterprise_custom') THEN true ELSE COALESCE((features->>'market_source_imports')::boolean, false) END
),
updated_at = now();
