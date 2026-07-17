-- DealFlowIQ Batch 37 — Community invite team roles and conversation moderation.
-- Run after 036_flip_holding_months.sql.

-- 1) accept_community_invite: the community team membership role now honors the
--    invite's role, mapped into the allowed team roles (owner/admin/coach/member/viewer).
--    Org-only roles (acquisition_manager, disposition_manager, buyer) map to 'member'.
--    Body copied from 017_community_invites_signup_codes.sql; only the team role changed.
CREATE OR REPLACE FUNCTION public.accept_community_invite(_invite_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _email text := lower(coalesce(auth.email(), ''));
  _code text := public.normalize_invite_code(_invite_code);
  _invite public.community_invites%ROWTYPE;
  _team_role text;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF _code IS NULL OR length(_code) < 4 THEN
    RAISE EXCEPTION 'Invalid invite code';
  END IF;

  SELECT * INTO _invite
  FROM public.community_invites
  WHERE lower(invite_code) = lower(_code)
    AND status = 'active'
    AND (expires_at IS NULL OR expires_at > now())
    AND accepted_count < max_uses
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite code is invalid, expired, revoked or already used';
  END IF;

  IF _invite.email IS NOT NULL AND lower(_invite.email) <> _email THEN
    RAISE EXCEPTION 'This invite is assigned to a different email address';
  END IF;

  INSERT INTO public.organization_members (organization_id, user_id, role, status)
  VALUES (_invite.organization_id, _user_id, _invite.role, 'active')
  ON CONFLICT (organization_id, user_id) DO UPDATE SET
    role = EXCLUDED.role,
    status = 'active',
    updated_at = now();

  IF _invite.team_id IS NOT NULL THEN
    _team_role := CASE _invite.role::text
      WHEN 'owner' THEN 'owner'
      WHEN 'admin' THEN 'admin'
      WHEN 'coach' THEN 'coach'
      WHEN 'member' THEN 'member'
      WHEN 'viewer' THEN 'viewer'
      ELSE 'member'
    END;

    INSERT INTO public.community_team_members (organization_id, team_id, user_id, role)
    VALUES (_invite.organization_id, _invite.team_id, _user_id, _team_role)
    ON CONFLICT (team_id, user_id) DO UPDATE SET
      role = EXCLUDED.role,
      updated_at = now();
  END IF;

  UPDATE public.community_invites
  SET accepted_count = accepted_count + 1,
      accepted_by = _user_id,
      accepted_at = now(),
      status = CASE WHEN accepted_count + 1 >= max_uses THEN 'accepted' ELSE status END,
      updated_at = now()
  WHERE id = _invite.id;

  UPDATE public.profiles
  SET pending_invite_code = NULL,
      onboarding_completed = true,
      updated_at = now()
  WHERE id = _user_id;

  INSERT INTO public.audit_logs (organization_id, actor_id, event_type, entity_type, entity_id, metadata)
  VALUES (
    _invite.organization_id,
    _user_id,
    'community_invite.accepted',
    'community_invite',
    _invite.id,
    jsonb_build_object('team_id', _invite.team_id, 'role', _invite.role::text, 'email', _email)
  );

  RETURN _invite.organization_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_community_invite(text) TO authenticated;

-- 2) conversation_reports moderation columns. The table (027) already has a
--    status column, but with a CHECK that does not cover the moderation queue
--    resolutions (reviewed/actioned) and no reviewer tracking columns.
ALTER TABLE public.conversation_reports
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'conversation_reports'
      AND constraint_name = 'conversation_reports_status_check'
  ) THEN
    ALTER TABLE public.conversation_reports DROP CONSTRAINT conversation_reports_status_check;
  END IF;

  -- Migrate legacy statuses from the 027 vocabulary before tightening the check.
  UPDATE public.conversation_reports SET status = 'open' WHERE status = 'reviewing';
  UPDATE public.conversation_reports SET status = 'reviewed' WHERE status = 'resolved';

  ALTER TABLE public.conversation_reports
    ADD CONSTRAINT conversation_reports_status_check
    CHECK (status IN ('open', 'reviewed', 'dismissed', 'actioned'));
END $$;

-- 3) Platform-admin RLS on conversation_reports. 027 already grants admins
--    SELECT (reporter-or-admin policy) and UPDATE; re-assert both so the
--    moderation queue's required access is explicit in this migration.
DROP POLICY IF EXISTS conversation_reports_select_reporter_or_admin ON public.conversation_reports;
CREATE POLICY conversation_reports_select_reporter_or_admin
ON public.conversation_reports FOR SELECT
TO authenticated
USING (reported_by_user_id = auth.uid() OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS conversation_reports_update_platform_admin ON public.conversation_reports;
CREATE POLICY conversation_reports_update_platform_admin
ON public.conversation_reports FOR UPDATE
TO authenticated
USING (public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_platform_admin());

-- 4) Invite creation rate limiting reads count invites per org per 24h.
--    017 already creates this index; keep it guaranteed here.
CREATE INDEX IF NOT EXISTS idx_community_invites_org_created ON public.community_invites(organization_id, created_at DESC);

COMMENT ON COLUMN public.conversation_reports.status IS 'Moderation queue state: open, reviewed, dismissed or actioned.';
COMMENT ON COLUMN public.conversation_reports.reviewed_by IS 'Platform admin who resolved the report.';
