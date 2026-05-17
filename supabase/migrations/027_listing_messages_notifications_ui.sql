-- DealFlowIQ Batch 27 — Listing contact, messages, notification center and UI hooks.
-- Run after Batch 25/26 freemium access migrations.

create extension if not exists pgcrypto;

-- 1) Listing-level contact preferences. Direct email/phone is hidden by default.
CREATE TABLE IF NOT EXISTS public.listing_contact_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL UNIQUE REFERENCES public.market_listings(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  allow_in_app_messages boolean NOT NULL DEFAULT true,
  contact_email text,
  contact_phone text,
  email_visibility text NOT NULL DEFAULT 'hidden' CHECK (email_visibility IN ('hidden', 'paid_only', 'all_logged_in')),
  phone_visibility text NOT NULL DEFAULT 'hidden' CHECK (phone_visibility IN ('hidden', 'paid_only', 'all_logged_in')),
  preferred_contact_method text NOT NULL DEFAULT 'in_app' CHECK (preferred_contact_method IN ('in_app', 'email', 'phone')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_listing_contact_settings_updated_at ON public.listing_contact_settings;
CREATE TRIGGER set_listing_contact_settings_updated_at
BEFORE UPDATE ON public.listing_contact_settings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_listing_contact_settings_org ON public.listing_contact_settings(organization_id, listing_id);

ALTER TABLE public.listing_contact_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS listing_contact_settings_select_visible ON public.listing_contact_settings;
CREATE POLICY listing_contact_settings_select_visible
ON public.listing_contact_settings FOR SELECT
TO authenticated
USING (
  public.current_user_is_platform_admin()
  OR EXISTS (
    SELECT 1 FROM public.market_listings ml
    WHERE ml.id = listing_contact_settings.listing_id
      AND (ml.visibility = 'public' OR public.current_user_is_org_member(ml.organization_id))
  )
);

DROP POLICY IF EXISTS listing_contact_settings_manage_owner_admin ON public.listing_contact_settings;
CREATE POLICY listing_contact_settings_manage_owner_admin
ON public.listing_contact_settings FOR ALL
TO authenticated
USING (
  public.current_user_is_platform_admin()
  OR EXISTS (
    SELECT 1 FROM public.market_listings ml
    WHERE ml.id = listing_contact_settings.listing_id
      AND (ml.created_by = auth.uid() OR public.current_user_has_org_role(ml.organization_id, ARRAY['owner','admin']))
  )
)
WITH CHECK (
  public.current_user_is_platform_admin()
  OR EXISTS (
    SELECT 1 FROM public.market_listings ml
    WHERE ml.id = listing_contact_settings.listing_id
      AND (ml.created_by = auth.uid() OR public.current_user_has_org_role(ml.organization_id, ARRAY['owner','admin']))
  )
);

-- 2) One conversation per buyer/listing/owner pair.
CREATE TABLE IF NOT EXISTS public.listing_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.market_listings(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  community_id uuid,
  buyer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'replied', 'contacted', 'offer_discussed', 'offer_submitted', 'under_contract', 'closed', 'rejected', 'archived')),
  last_message_preview text,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, buyer_user_id, owner_user_id)
);

DROP TRIGGER IF EXISTS set_listing_conversations_updated_at ON public.listing_conversations;
CREATE TRIGGER set_listing_conversations_updated_at
BEFORE UPDATE ON public.listing_conversations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_listing_conversations_buyer_time ON public.listing_conversations(buyer_user_id, last_message_at DESC NULLS LAST, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listing_conversations_owner_time ON public.listing_conversations(owner_user_id, last_message_at DESC NULLS LAST, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listing_conversations_listing ON public.listing_conversations(listing_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listing_conversations_org_status ON public.listing_conversations(organization_id, status, updated_at DESC);

ALTER TABLE public.listing_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS listing_conversations_select_participant_admin ON public.listing_conversations;
CREATE POLICY listing_conversations_select_participant_admin
ON public.listing_conversations FOR SELECT
TO authenticated
USING (
  buyer_user_id = auth.uid()
  OR owner_user_id = auth.uid()
  OR public.current_user_is_platform_admin()
  OR public.current_user_has_org_role(organization_id, ARRAY['owner','admin'])
);

DROP POLICY IF EXISTS listing_conversations_insert_participant ON public.listing_conversations;
CREATE POLICY listing_conversations_insert_participant
ON public.listing_conversations FOR INSERT
TO authenticated
WITH CHECK (
  buyer_user_id = auth.uid()
  OR owner_user_id = auth.uid()
  OR public.current_user_is_platform_admin()
);

DROP POLICY IF EXISTS listing_conversations_update_participant_admin ON public.listing_conversations;
CREATE POLICY listing_conversations_update_participant_admin
ON public.listing_conversations FOR UPDATE
TO authenticated
USING (
  buyer_user_id = auth.uid()
  OR owner_user_id = auth.uid()
  OR public.current_user_is_platform_admin()
  OR public.current_user_has_org_role(organization_id, ARRAY['owner','admin'])
)
WITH CHECK (
  buyer_user_id = auth.uid()
  OR owner_user_id = auth.uid()
  OR public.current_user_is_platform_admin()
  OR public.current_user_has_org_role(organization_id, ARRAY['owner','admin'])
);

-- 3) Messages in a conversation. read_at tracks recipient-read state for the two-party thread.
CREATE TABLE IF NOT EXISTS public.listing_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.listing_conversations(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES public.market_listings(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 4000),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_messages_conversation_time ON public.listing_messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_listing_messages_sender_time ON public.listing_messages(sender_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listing_messages_unread ON public.listing_messages(conversation_id, sender_user_id, created_at DESC) WHERE read_at IS NULL;

ALTER TABLE public.listing_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS listing_messages_select_participant_admin ON public.listing_messages;
CREATE POLICY listing_messages_select_participant_admin
ON public.listing_messages FOR SELECT
TO authenticated
USING (
  public.current_user_is_platform_admin()
  OR EXISTS (
    SELECT 1 FROM public.listing_conversations lc
    WHERE lc.id = listing_messages.conversation_id
      AND (lc.buyer_user_id = auth.uid() OR lc.owner_user_id = auth.uid() OR public.current_user_has_org_role(lc.organization_id, ARRAY['owner','admin']))
  )
);

DROP POLICY IF EXISTS listing_messages_insert_participant ON public.listing_messages;
CREATE POLICY listing_messages_insert_participant
ON public.listing_messages FOR INSERT
TO authenticated
WITH CHECK (
  sender_user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.listing_conversations lc
    WHERE lc.id = listing_messages.conversation_id
      AND (lc.buyer_user_id = auth.uid() OR lc.owner_user_id = auth.uid())
  )
);

DROP POLICY IF EXISTS listing_messages_update_read_state ON public.listing_messages;
CREATE POLICY listing_messages_update_read_state
ON public.listing_messages FOR UPDATE
TO authenticated
USING (
  public.current_user_is_platform_admin()
  OR EXISTS (
    SELECT 1 FROM public.listing_conversations lc
    WHERE lc.id = listing_messages.conversation_id
      AND (lc.buyer_user_id = auth.uid() OR lc.owner_user_id = auth.uid())
  )
)
WITH CHECK (
  public.current_user_is_platform_admin()
  OR EXISTS (
    SELECT 1 FROM public.listing_conversations lc
    WHERE lc.id = listing_messages.conversation_id
      AND (lc.buyer_user_id = auth.uid() OR lc.owner_user_id = auth.uid())
  )
);

-- 4) Reports/moderation queue.
CREATE TABLE IF NOT EXISTS public.conversation_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.listing_conversations(id) ON DELETE CASCADE,
  reported_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_conversation_reports_updated_at ON public.conversation_reports;
CREATE TRIGGER set_conversation_reports_updated_at
BEFORE UPDATE ON public.conversation_reports
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_conversation_reports_status ON public.conversation_reports(status, created_at DESC);

ALTER TABLE public.conversation_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_reports_select_reporter_or_admin ON public.conversation_reports;
CREATE POLICY conversation_reports_select_reporter_or_admin
ON public.conversation_reports FOR SELECT
TO authenticated
USING (reported_by_user_id = auth.uid() OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS conversation_reports_insert_participant ON public.conversation_reports;
CREATE POLICY conversation_reports_insert_participant
ON public.conversation_reports FOR INSERT
TO authenticated
WITH CHECK (reported_by_user_id = auth.uid());

DROP POLICY IF EXISTS conversation_reports_update_platform_admin ON public.conversation_reports;
CREATE POLICY conversation_reports_update_platform_admin
ON public.conversation_reports FOR UPDATE
TO authenticated
USING (public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_platform_admin());

-- 5) Notification types now cover buy-box/deal alerts and message alerts.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='public' AND table_name='notifications' AND constraint_name='notifications_type_check') THEN
    ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
  END IF;

  ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'system','admin_alert','system_alert',
    'import_analyzed','import_completed','import_failed','import_rate_limited','provider_data_expiring','provider_data_expired','cleanup_completed',
    'opportunity_found','buyer_match','buy_box_match','buy_box_run_completed','new_listing','price_drop','deal_score_alert','saved_deal_score_changed',
    'community_deal','community_activity','message_received',
    'rent_confidence_review','rent_analysis_failed','hud_lookup_failed',
    'deal_note_added','deal_status_changed','duplicate_listing_detected','manual_override_changed',
    'trial_ending','payment_required','subscription_updated'
  ));
END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_user_archived_created ON public.notifications(user_id, archived_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_type_created ON public.notifications(type, created_at DESC) WHERE archived_at IS NULL;

COMMENT ON TABLE public.listing_conversations IS 'Two-party in-app deal conversations tied to a market listing.';
COMMENT ON TABLE public.listing_messages IS 'Messages inside listing conversations. Free-user rate limits are enforced in server actions.';
COMMENT ON TABLE public.listing_contact_settings IS 'Per-listing contact settings. Email/phone are hidden by default and owner-controlled.';
