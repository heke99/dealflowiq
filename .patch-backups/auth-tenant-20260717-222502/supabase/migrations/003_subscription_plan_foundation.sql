-- DealFlowIQ Batch 1+2 — Account-type access + subscription/plan/trial foundation
-- Run after 001_batch1_saas_foundation.sql and 002_auth_onboarding_account_types.sql.
-- This does NOT connect Stripe yet. It creates the internal SaaS billing/access model first.

create extension if not exists pgcrypto;

-- 1) Platform admins: add yourself manually after running this migration.
CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text
);

-- 2) Billing plans managed by platform admin.
CREATE TABLE IF NOT EXISTS public.billing_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  currency text NOT NULL DEFAULT 'usd',
  monthly_price_cents integer NOT NULL DEFAULT 0 CHECK (monthly_price_cents >= 0),
  annual_price_cents integer NOT NULL DEFAULT 0 CHECK (annual_price_cents >= 0),
  trial_days integer NOT NULL DEFAULT 7 CHECK (trial_days >= 0),
  is_public boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 100,
  account_types text[] NOT NULL DEFAULT '{}'::text[],
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  stripe_product_id text,
  stripe_monthly_price_id text,
  stripe_annual_price_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.billing_plans
  DROP CONSTRAINT IF EXISTS billing_plans_code_format_check;
ALTER TABLE public.billing_plans
  ADD CONSTRAINT billing_plans_code_format_check
  CHECK (code ~ '^[a-z0-9_]+$');

-- 3) One active subscription/access record per organization for now.
CREATE TABLE IF NOT EXISTS public.organization_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES public.billing_plans(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'expired', 'comped', 'manually_granted')),
  trial_start_at timestamptz,
  trial_end_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_source text NOT NULL DEFAULT 'plan_default' CHECK (trial_source IN ('default_signup', 'plan_default', 'admin_override', 'invite_override', 'promotion', 'custom_deal')),
  stripe_customer_id text,
  stripe_subscription_id text,
  features_override jsonb NOT NULL DEFAULT '{}'::jsonb,
  limits_override jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  manually_granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id)
);

-- 4) Trial/invite grants. Later this can be connected to real invite emails.
CREATE TABLE IF NOT EXISTS public.subscription_trial_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES public.billing_plans(id) ON DELETE SET NULL,
  trial_days integer NOT NULL DEFAULT 7 CHECK (trial_days >= 0),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'revoked', 'expired')),
  source text NOT NULL DEFAULT 'admin_override' CHECK (source IN ('admin_override', 'invite_override', 'promotion', 'custom_deal')),
  notes text,
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 5) Updated-at triggers
DROP TRIGGER IF EXISTS set_billing_plans_updated_at ON public.billing_plans;
CREATE TRIGGER set_billing_plans_updated_at
BEFORE UPDATE ON public.billing_plans
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_organization_subscriptions_updated_at ON public.organization_subscriptions;
CREATE TRIGGER set_organization_subscriptions_updated_at
BEFORE UPDATE ON public.organization_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_subscription_trial_grants_updated_at ON public.subscription_trial_grants;
CREATE TRIGGER set_subscription_trial_grants_updated_at
BEFORE UPDATE ON public.subscription_trial_grants
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6) Admin helper
CREATE OR REPLACE FUNCTION public.current_user_is_platform_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid()
  );
$$;

-- 7) Plan seed data. Admin can edit these later in /admin/plans.
INSERT INTO public.billing_plans (
  code, name, description, currency, monthly_price_cents, annual_price_cents, trial_days, is_public, is_active, display_order, account_types, features, limits
) VALUES
(
  'solo_investor',
  'Solo Investor',
  'For individual investors analyzing rental, BRRRR, flip and wholesale deals.',
  'usd', 4900, 47000, 7, true, true, 10,
  ARRAY['solo_investor', 'brrrr_investor', 'fix_and_flip_investor'],
  '{"deals":true,"rent_analysis":true,"market_rent":true,"section8_hud":true,"brrrr":true,"flip":true,"wholesale":true,"five_year_projection":true,"csv_export":true,"lender_view":true}'::jsonb,
  '{"max_deals":25,"max_buyers":0,"max_team_members":1,"max_hud_lookups":100,"max_ai_reviews":0,"max_deal_landing_pages":5}'::jsonb
),
(
  'landlord',
  'Landlord',
  'For landlords focused on rent upside, Section 8 benchmarks, NOI, cap rate and DSCR.',
  'usd', 3900, 37000, 7, true, true, 20,
  ARRAY['landlord', 'section_8_landlord'],
  '{"deals":true,"rent_analysis":true,"market_rent":true,"section8_hud":true,"five_year_projection":true,"csv_export":true,"lender_view":true}'::jsonb,
  '{"max_deals":50,"max_buyers":0,"max_team_members":1,"max_hud_lookups":250,"max_ai_reviews":0,"max_deal_landing_pages":5}'::jsonb
),
(
  'wholesaler',
  'Wholesaler',
  'For wholesalers using ARV, rehab, spread, buyer list and buyer matching workflows.',
  'usd', 7900, 75800, 14, true, true, 30,
  ARRAY['wholesaler'],
  '{"deals":true,"rent_analysis":true,"market_rent":true,"flip":true,"wholesale":true,"buyers":true,"buyer_matching":true,"deal_distribution":true,"deal_landing_pages":true,"csv_export":true}'::jsonb,
  '{"max_deals":100,"max_buyers":500,"max_team_members":2,"max_hud_lookups":100,"max_ai_reviews":0,"max_deal_landing_pages":25}'::jsonb
),
(
  'team_company',
  'Team / Company',
  'For teams running acquisitions, dispositions, underwriting and buyer CRM together.',
  'usd', 14900, 143000, 14, true, true, 40,
  ARRAY['team_company'],
  '{"deals":true,"rent_analysis":true,"market_rent":true,"section8_hud":true,"brrrr":true,"flip":true,"wholesale":true,"five_year_projection":true,"csv_export":true,"pdf_export":true,"buyers":true,"buyer_matching":true,"deal_distribution":true,"lender_view":true}'::jsonb,
  '{"max_deals":500,"max_buyers":2500,"max_team_members":10,"max_hud_lookups":1000,"max_ai_reviews":0,"max_deal_landing_pages":100}'::jsonb
),
(
  'community_guru',
  'Community / Guru',
  'For communities, gurus and groups where members submit deals for review and distribution.',
  'usd', 29900, 287000, 30, true, true, 50,
  ARRAY['community_guru_owner'],
  '{"deals":true,"rent_analysis":true,"market_rent":true,"section8_hud":true,"brrrr":true,"flip":true,"wholesale":true,"five_year_projection":true,"csv_export":true,"pdf_export":true,"buyers":true,"buyer_matching":true,"deal_distribution":true,"community_members":true,"white_label":true,"lender_view":true}'::jsonb,
  '{"max_deals":2000,"max_buyers":10000,"max_team_members":50,"max_hud_lookups":5000,"max_ai_reviews":0,"max_deal_landing_pages":500,"max_community_members":500}'::jsonb
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  currency = EXCLUDED.currency,
  monthly_price_cents = EXCLUDED.monthly_price_cents,
  annual_price_cents = EXCLUDED.annual_price_cents,
  trial_days = EXCLUDED.trial_days,
  is_public = EXCLUDED.is_public,
  is_active = EXCLUDED.is_active,
  display_order = EXCLUDED.display_order,
  account_types = EXCLUDED.account_types,
  features = EXCLUDED.features,
  limits = EXCLUDED.limits,
  updated_at = now();

-- 8) Function to choose a plan for a signup/account type.
CREATE OR REPLACE FUNCTION public.default_plan_for_account_type(_account_type text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  _plan_id uuid;
BEGIN
  SELECT bp.id INTO _plan_id
  FROM public.billing_plans bp
  WHERE bp.is_active = true
    AND bp.is_public = true
    AND (_account_type = ANY(bp.account_types) OR cardinality(bp.account_types) = 0)
  ORDER BY
    CASE WHEN _account_type = ANY(bp.account_types) THEN 0 ELSE 1 END,
    bp.display_order ASC,
    bp.created_at ASC
  LIMIT 1;

  RETURN _plan_id;
END;
$$;

-- 9) Ensure org has an access/subscription record.
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

  _trial_days := COALESCE(_trial_days, 7);
  _trial_end := now() + make_interval(days => _trial_days);

  INSERT INTO public.organization_subscriptions (
    organization_id,
    plan_id,
    status,
    trial_start_at,
    trial_end_at,
    current_period_start,
    current_period_end,
    trial_source,
    notes
  ) VALUES (
    _organization_id,
    _plan_id,
    CASE WHEN _trial_days > 0 THEN 'trialing' ELSE 'active' END,
    CASE WHEN _trial_days > 0 THEN now() ELSE NULL END,
    CASE WHEN _trial_days > 0 THEN _trial_end ELSE NULL END,
    now(),
    _trial_end,
    'plan_default',
    'Created automatically when workspace was created.'
  )
  RETURNING id INTO _subscription_id;

  INSERT INTO public.audit_logs (organization_id, actor_id, event_type, entity_type, entity_id, metadata)
  VALUES (
    _organization_id,
    auth.uid(),
    'subscription.created',
    'organization_subscription',
    _subscription_id,
    jsonb_build_object('source', 'ensure_organization_subscription', 'account_type', _account_type, 'trial_days', _trial_days)
  );

  RETURN _subscription_id;
END;
$$;

-- 10) Upgrade default organization creator to also attach plan/trial.
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

  RETURN _org_id;
END;
$$;

-- 11) RLS
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_trial_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_admins_select_self_or_admin ON public.platform_admins;
CREATE POLICY platform_admins_select_self_or_admin
ON public.platform_admins FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS platform_admins_manage_admin ON public.platform_admins;
CREATE POLICY platform_admins_manage_admin
ON public.platform_admins FOR ALL
TO authenticated
USING (public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_platform_admin());

DROP POLICY IF EXISTS billing_plans_select_public_or_admin ON public.billing_plans;
CREATE POLICY billing_plans_select_public_or_admin
ON public.billing_plans FOR SELECT
TO authenticated
USING ((is_public = true AND is_active = true) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS billing_plans_manage_admin ON public.billing_plans;
CREATE POLICY billing_plans_manage_admin
ON public.billing_plans FOR ALL
TO authenticated
USING (public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_platform_admin());

DROP POLICY IF EXISTS organization_subscriptions_select_member_or_admin ON public.organization_subscriptions;
CREATE POLICY organization_subscriptions_select_member_or_admin
ON public.organization_subscriptions FOR SELECT
TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS organization_subscriptions_manage_admin ON public.organization_subscriptions;
CREATE POLICY organization_subscriptions_manage_admin
ON public.organization_subscriptions FOR ALL
TO authenticated
USING (public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_platform_admin());

DROP POLICY IF EXISTS subscription_trial_grants_select_admin ON public.subscription_trial_grants;
CREATE POLICY subscription_trial_grants_select_admin
ON public.subscription_trial_grants FOR SELECT
TO authenticated
USING (public.current_user_is_platform_admin());

DROP POLICY IF EXISTS subscription_trial_grants_manage_admin ON public.subscription_trial_grants;
CREATE POLICY subscription_trial_grants_manage_admin
ON public.subscription_trial_grants FOR ALL
TO authenticated
USING (public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_platform_admin());

-- 12) Grants + indexes
GRANT EXECUTE ON FUNCTION public.current_user_is_platform_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.default_plan_for_account_type(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_organization_subscription(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_default_organization() TO authenticated;

CREATE INDEX IF NOT EXISTS idx_billing_plans_active_order ON public.billing_plans(is_active, is_public, display_order);
CREATE INDEX IF NOT EXISTS idx_organization_subscriptions_org ON public.organization_subscriptions(organization_id);
CREATE INDEX IF NOT EXISTS idx_organization_subscriptions_status ON public.organization_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscription_trial_grants_email ON public.subscription_trial_grants(lower(email));
CREATE INDEX IF NOT EXISTS idx_subscription_trial_grants_org ON public.subscription_trial_grants(organization_id);
