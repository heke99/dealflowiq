-- DealFlowIQ Batch 12K — 7-day signup trial, payment restriction state, and member-level admin overrides.
-- Run after 025_admin_subscription_plan_polish.sql.

create extension if not exists pgcrypto;

-- 1) Admins need real platform visibility in admin dashboards.
DROP POLICY IF EXISTS profiles_select_own_or_platform_admin ON public.profiles;
CREATE POLICY profiles_select_own_or_platform_admin
ON public.profiles FOR SELECT
TO authenticated
USING (id = auth.uid() OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS organizations_select_member_or_platform_admin ON public.organizations;
CREATE POLICY organizations_select_member_or_platform_admin
ON public.organizations FOR SELECT
TO authenticated
USING (owner_id = auth.uid() OR public.current_user_is_org_member(id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS organization_members_select_same_org_or_platform_admin ON public.organization_members;
CREATE POLICY organization_members_select_same_org_or_platform_admin
ON public.organization_members FOR SELECT
TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS audit_logs_select_org_member_or_platform_admin ON public.audit_logs;
CREATE POLICY audit_logs_select_org_member_or_platform_admin
ON public.audit_logs FOR SELECT
TO authenticated
USING (organization_id IS NULL OR public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

-- 2) Existing plans should default to a clear 7-day signup trial again.
-- Admin can still change trial_days per plan in /admin/plans.
UPDATE public.billing_plans
SET trial_days = 7,
    updated_at = now()
WHERE is_public = true
  AND is_active = true
  AND trial_days <> 7;

-- 3) Member-level access override. This is not for platform admins;
-- they already bypass billing through platform_admins.
CREATE TABLE IF NOT EXISTS public.member_access_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'full_access' CHECK (status IN ('full_access', 'restricted', 'revoked')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  features_override jsonb NOT NULL DEFAULT '{}'::jsonb,
  limits_override jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

DROP TRIGGER IF EXISTS set_member_access_overrides_updated_at ON public.member_access_overrides;
CREATE TRIGGER set_member_access_overrides_updated_at
BEFORE UPDATE ON public.member_access_overrides
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.member_access_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS member_access_overrides_select_own_org_or_platform_admin ON public.member_access_overrides;
CREATE POLICY member_access_overrides_select_own_org_or_platform_admin
ON public.member_access_overrides FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS member_access_overrides_manage_platform_admin ON public.member_access_overrides;
CREATE POLICY member_access_overrides_manage_platform_admin
ON public.member_access_overrides FOR ALL
TO authenticated
USING (public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_platform_admin());

CREATE INDEX IF NOT EXISTS idx_member_access_overrides_org_user ON public.member_access_overrides(organization_id, user_id);
CREATE INDEX IF NOT EXISTS idx_member_access_overrides_status ON public.member_access_overrides(status);
CREATE INDEX IF NOT EXISTS idx_member_access_overrides_expires_at ON public.member_access_overrides(expires_at);

-- 4) Admin access invites now mean full/manual access unless a trial is explicitly set.
CREATE OR REPLACE FUNCTION public.apply_admin_access_invite(_organization_id uuid, _user_id uuid, _email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _invite public.admin_access_invites%ROWTYPE;
  _plan_id uuid;
  _trial_days integer;
  _period_end timestamptz;
  _subscription_id uuid;
BEGIN
  SELECT * INTO _invite
  FROM public.admin_access_invites i
  WHERE lower(i.email) = lower(_email)
    AND i.status = 'active'
    AND (i.expires_at IS NULL OR i.expires_at > now())
  ORDER BY i.created_at DESC
  LIMIT 1;

  IF _invite.id IS NULL THEN
    RETURN NULL;
  END IF;

  _plan_id := COALESCE(_invite.plan_id, public.default_plan_for_account_type(_invite.account_type));
  _trial_days := COALESCE(_invite.trial_days, 0);
  _period_end := CASE WHEN _trial_days > 0 THEN now() + make_interval(days => _trial_days) ELSE NULL END;

  UPDATE public.organizations
  SET name = COALESCE(NULLIF(_invite.organization_name, ''), name),
      organization_type = _invite.account_type,
      account_type = _invite.account_type,
      updated_at = now()
  WHERE id = _organization_id;

  UPDATE public.organization_members
  SET role = _invite.role,
      status = 'active',
      updated_at = now()
  WHERE organization_id = _organization_id
    AND user_id = _user_id;

  UPDATE public.profiles
  SET account_type = _invite.account_type,
      organization_name = COALESCE(NULLIF(_invite.organization_name, ''), organization_name),
      updated_at = now()
  WHERE id = _user_id;

  INSERT INTO public.organization_subscriptions (
    organization_id,
    plan_id,
    status,
    trial_start_at,
    trial_end_at,
    current_period_start,
    current_period_end,
    trial_source,
    features_override,
    limits_override,
    notes,
    manually_granted_by
  ) VALUES (
    _organization_id,
    _plan_id,
    CASE WHEN _trial_days > 0 THEN 'trialing' ELSE 'manually_granted' END,
    CASE WHEN _trial_days > 0 THEN now() ELSE NULL END,
    CASE WHEN _trial_days > 0 THEN _period_end ELSE NULL END,
    now(),
    _period_end,
    'invite_override',
    COALESCE(_invite.features_override, '{}'::jsonb),
    COALESCE(_invite.limits_override, '{}'::jsonb),
    COALESCE(_invite.notes, CASE WHEN _trial_days > 0 THEN 'Admin invite trial applied.' ELSE 'Admin invite full access applied.' END),
    _invite.created_by
  )
  ON CONFLICT (organization_id) DO UPDATE SET
    plan_id = EXCLUDED.plan_id,
    status = EXCLUDED.status,
    trial_start_at = EXCLUDED.trial_start_at,
    trial_end_at = EXCLUDED.trial_end_at,
    current_period_start = EXCLUDED.current_period_start,
    current_period_end = EXCLUDED.current_period_end,
    trial_source = EXCLUDED.trial_source,
    features_override = EXCLUDED.features_override,
    limits_override = EXCLUDED.limits_override,
    notes = EXCLUDED.notes,
    manually_granted_by = EXCLUDED.manually_granted_by,
    updated_at = now()
  RETURNING id INTO _subscription_id;

  UPDATE public.admin_access_invites
  SET status = 'used',
      invited_user_id = _user_id,
      organization_id = _organization_id,
      used_at = now(),
      updated_at = now()
  WHERE id = _invite.id;

  INSERT INTO public.audit_logs (organization_id, actor_id, event_type, entity_type, entity_id, metadata)
  VALUES (
    _organization_id,
    _invite.created_by,
    'admin_access_invite.applied',
    'admin_access_invite',
    _invite.id,
    jsonb_build_object('email', _email, 'account_type', _invite.account_type, 'trial_days', _trial_days)
  );

  RETURN _invite.id;
END;
$$;

-- 5) New normal signup gets 7 days full access. Platform admins do not get trial state.
CREATE OR REPLACE FUNCTION public.ensure_organization_subscription(_organization_id uuid, _account_type text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _existing_id uuid;
  _plan_id uuid;
  _trial_days integer := 7;
  _subscription_id uuid;
  _trial_end timestamptz;
  _is_platform_admin boolean := public.current_user_is_platform_admin();
BEGIN
  SELECT id INTO _existing_id
  FROM public.organization_subscriptions
  WHERE organization_id = _organization_id
  LIMIT 1;

  IF _existing_id IS NOT NULL THEN
    RETURN _existing_id;
  END IF;

  _plan_id := public.default_plan_for_account_type(COALESCE(_account_type, 'solo_investor'));

  SELECT COALESCE(bp.trial_days, 7)
  INTO _trial_days
  FROM public.billing_plans bp
  WHERE bp.id = _plan_id;

  _trial_days := CASE WHEN _is_platform_admin THEN 0 ELSE COALESCE(NULLIF(_trial_days, 0), 7) END;
  _trial_end := CASE WHEN _trial_days > 0 THEN now() + make_interval(days => _trial_days) ELSE NULL END;

  INSERT INTO public.organization_subscriptions (
    organization_id,
    plan_id,
    status,
    trial_start_at,
    trial_end_at,
    current_period_start,
    current_period_end,
    trial_source,
    notes,
    manually_granted_by
  ) VALUES (
    _organization_id,
    _plan_id,
    CASE WHEN _trial_days > 0 THEN 'trialing' ELSE 'manually_granted' END,
    CASE WHEN _trial_days > 0 THEN now() ELSE NULL END,
    _trial_end,
    now(),
    _trial_end,
    CASE WHEN _trial_days > 0 THEN 'plan_default' ELSE 'admin_override' END,
    CASE WHEN _trial_days > 0 THEN 'Created automatically with 7-day signup trial.' ELSE 'Created automatically for platform admin without trial.' END,
    CASE WHEN _is_platform_admin THEN auth.uid() ELSE NULL END
  )
  RETURNING id INTO _subscription_id;

  INSERT INTO public.audit_logs (organization_id, actor_id, event_type, entity_type, entity_id, metadata)
  VALUES (
    _organization_id,
    auth.uid(),
    'subscription.created',
    'organization_subscription',
    _subscription_id,
    jsonb_build_object('source', 'ensure_organization_subscription', 'account_type', _account_type, 'trial_days', _trial_days, 'platform_admin', _is_platform_admin)
  );

  RETURN _subscription_id;
END;
$$;

-- 6) Final create_default_organization combines community invite handling, admin invite handling and subscription creation.
CREATE OR REPLACE FUNCTION public.create_default_organization()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _email text := auth.email();
  _existing_org_id uuid;
  _org_id uuid;
  _base_name text;
  _slug text;
  _account_type text := 'solo_investor';
  _organization_name text;
  _pending_invite_code text;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    _user_id,
    _email,
    COALESCE(split_part(_email, '@', 1), 'User')
  )
  ON CONFLICT (id) DO UPDATE SET
    email = COALESCE(EXCLUDED.email, public.profiles.email),
    updated_at = now();

  SELECT public.normalize_invite_code(p.pending_invite_code)
  INTO _pending_invite_code
  FROM public.profiles p
  WHERE p.id = _user_id;

  IF _pending_invite_code IS NOT NULL AND length(_pending_invite_code) >= 4 THEN
    BEGIN
      _org_id := public.accept_community_invite(_pending_invite_code);
      SELECT COALESCE(o.account_type, o.organization_type, p.account_type, 'solo_investor')
      INTO _account_type
      FROM public.organizations o
      LEFT JOIN public.profiles p ON p.id = _user_id
      WHERE o.id = _org_id;
      PERFORM public.ensure_organization_subscription(_org_id, _account_type);
      PERFORM public.apply_admin_access_invite(_org_id, _user_id, _email);
      RETURN _org_id;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.profiles
      SET pending_invite_code = NULL,
          updated_at = now()
      WHERE id = _user_id;
    END;
  END IF;

  SELECT om.organization_id
  INTO _existing_org_id
  FROM public.organization_members om
  WHERE om.user_id = _user_id
    AND om.status = 'active'
  ORDER BY om.created_at ASC
  LIMIT 1;

  IF _existing_org_id IS NOT NULL THEN
    SELECT COALESCE(o.account_type, o.organization_type, p.account_type, 'solo_investor')
    INTO _account_type
    FROM public.organizations o
    LEFT JOIN public.profiles p ON p.id = _user_id
    WHERE o.id = _existing_org_id;

    PERFORM public.ensure_organization_subscription(_existing_org_id, _account_type);
    PERFORM public.apply_admin_access_invite(_existing_org_id, _user_id, _email);
    RETURN _existing_org_id;
  END IF;

  SELECT
    COALESCE(p.account_type, 'solo_investor'),
    NULLIF(p.organization_name, '')
  INTO _account_type, _organization_name
  FROM public.profiles p
  WHERE p.id = _user_id;

  _base_name := COALESCE(
    _organization_name,
    CASE _account_type
      WHEN 'community_guru_owner' THEN COALESCE(NULLIF(split_part(_email, '@', 1), ''), 'My') || '''s Community'
      WHEN 'team_company' THEN COALESCE(NULLIF(split_part(_email, '@', 1), ''), 'My') || '''s Team'
      ELSE COALESCE(NULLIF(split_part(_email, '@', 1), ''), 'My') || '''s Workspace'
    END
  );

  _slug := lower(regexp_replace(_base_name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(_user_id::text, 1, 8);
  _slug := trim(both '-' from _slug);

  INSERT INTO public.organizations (name, slug, owner_id, organization_type, account_type)
  VALUES (_base_name, _slug, _user_id, _account_type, _account_type)
  RETURNING id INTO _org_id;

  INSERT INTO public.organization_members (organization_id, user_id, role, status)
  VALUES (_org_id, _user_id, 'owner', 'active')
  ON CONFLICT (organization_id, user_id) DO UPDATE SET
    role = 'owner',
    status = 'active',
    updated_at = now();

  UPDATE public.profiles
  SET onboarding_completed = true,
      updated_at = now()
  WHERE id = _user_id;

  INSERT INTO public.audit_logs (organization_id, actor_id, event_type, entity_type, entity_id, metadata)
  VALUES (
    _org_id,
    _user_id,
    'organization.created',
    'organization',
    _org_id,
    jsonb_build_object('source', 'create_default_organization', 'account_type', _account_type)
  );

  PERFORM public.ensure_organization_subscription(_org_id, _account_type);
  PERFORM public.apply_admin_access_invite(_org_id, _user_id, _email);

  RETURN _org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_admin_access_invite(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_organization_subscription(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_default_organization() TO authenticated;
