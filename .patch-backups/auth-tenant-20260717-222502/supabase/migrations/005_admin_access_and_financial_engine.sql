-- DealFlowIQ Batch 4 + 5 — Financial engine fields, analyzer foundation, and admin access invites.
-- Run after 004_universal_core_access_and_deals.sql.

create extension if not exists pgcrypto;

-- 1) Add financing and strategy assumptions to deals.
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS down_payment_percent numeric(8,3) DEFAULT 20;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS down_payment_amount numeric(14,2);
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS loan_amount numeric(14,2);
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS interest_rate_percent numeric(8,3) DEFAULT 7;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS loan_term_years integer DEFAULT 30;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS closing_costs numeric(14,2);
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS selling_costs_percent numeric(8,3) DEFAULT 8;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS holding_costs_monthly numeric(14,2);
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS desired_wholesale_fee numeric(14,2) DEFAULT 10000;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS refinance_ltv_percent numeric(8,3) DEFAULT 75;

ALTER TABLE public.deals DROP CONSTRAINT IF EXISTS deals_financing_positive_check;
ALTER TABLE public.deals ADD CONSTRAINT deals_financing_positive_check CHECK (
  COALESCE(down_payment_percent, 0) >= 0
  AND COALESCE(down_payment_amount, 0) >= 0
  AND COALESCE(loan_amount, 0) >= 0
  AND COALESCE(interest_rate_percent, 0) >= 0
  AND COALESCE(loan_term_years, 0) >= 0
  AND COALESCE(closing_costs, 0) >= 0
  AND COALESCE(selling_costs_percent, 0) >= 0
  AND COALESCE(holding_costs_monthly, 0) >= 0
  AND COALESCE(desired_wholesale_fee, 0) >= 0
  AND COALESCE(refinance_ltv_percent, 0) >= 0
);

-- 2) Admin access invites/grants. Platform admin can invite a user and decide plan/trial/feature overrides.
CREATE TABLE IF NOT EXISTS public.admin_access_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  invite_token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  organization_name text,
  account_type text NOT NULL DEFAULT 'solo_investor',
  role public.org_member_role NOT NULL DEFAULT 'owner',
  plan_id uuid REFERENCES public.billing_plans(id) ON DELETE SET NULL,
  trial_days integer NOT NULL DEFAULT 7 CHECK (trial_days >= 0),
  features_override jsonb NOT NULL DEFAULT '{}'::jsonb,
  limits_override jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'revoked', 'expired')),
  invited_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  used_at timestamptz,
  expires_at timestamptz,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_admin_access_invites_updated_at ON public.admin_access_invites;
CREATE TRIGGER set_admin_access_invites_updated_at
BEFORE UPDATE ON public.admin_access_invites
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.admin_access_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_access_invites_manage_platform_admin ON public.admin_access_invites;
CREATE POLICY admin_access_invites_manage_platform_admin
ON public.admin_access_invites FOR ALL
TO authenticated
USING (public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_platform_admin());

-- 3) Applying an invite. This is called by create_default_organization after signup/login.
CREATE OR REPLACE FUNCTION public.apply_admin_access_invite(_organization_id uuid, _user_id uuid, _email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _invite public.admin_access_invites%ROWTYPE;
  _plan_id uuid;
  _trial_end timestamptz;
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
  _trial_end := now() + make_interval(days => COALESCE(_invite.trial_days, 7));

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
    CASE WHEN COALESCE(_invite.trial_days, 0) > 0 THEN 'trialing' ELSE 'manually_granted' END,
    CASE WHEN COALESCE(_invite.trial_days, 0) > 0 THEN now() ELSE NULL END,
    CASE WHEN COALESCE(_invite.trial_days, 0) > 0 THEN _trial_end ELSE NULL END,
    now(),
    CASE WHEN COALESCE(_invite.trial_days, 0) > 0 THEN _trial_end ELSE NULL END,
    'invite_override',
    COALESCE(_invite.features_override, '{}'::jsonb),
    COALESCE(_invite.limits_override, '{}'::jsonb),
    COALESCE(_invite.notes, 'Admin invite access applied.'),
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
    jsonb_build_object('email', _email, 'account_type', _invite.account_type, 'trial_days', _invite.trial_days)
  );

  RETURN _invite.id;
END;
$$;

-- 4) Upgrade workspace creator so admin invites can override plan/trial/features immediately on signup/login.
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
GRANT EXECUTE ON FUNCTION public.create_default_organization() TO authenticated;

CREATE INDEX IF NOT EXISTS idx_admin_access_invites_email_status ON public.admin_access_invites(lower(email), status);
CREATE INDEX IF NOT EXISTS idx_admin_access_invites_token ON public.admin_access_invites(invite_token);
CREATE INDEX IF NOT EXISTS idx_admin_access_invites_created_at ON public.admin_access_invites(created_at DESC);
