-- DealFlowIQ Batch 25 — Freemium access, admin user search, community owner visibility
-- Run after previous migrations.

create extension if not exists pgcrypto;

CREATE TABLE IF NOT EXISTS public.user_access_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  reason text,
  features_override jsonb NOT NULL DEFAULT '{}'::jsonb,
  limits_override jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_user_access_overrides_updated_at ON public.user_access_overrides;
CREATE TRIGGER set_user_access_overrides_updated_at
BEFORE UPDATE ON public.user_access_overrides
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_user_access_overrides_user_status ON public.user_access_overrides(user_id, status);
CREATE INDEX IF NOT EXISTS idx_user_access_overrides_org_status ON public.user_access_overrides(organization_id, status);

ALTER TABLE public.user_access_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_access_overrides_select_self_or_admin ON public.user_access_overrides;
CREATE POLICY user_access_overrides_select_self_or_admin
ON public.user_access_overrides FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS user_access_overrides_manage_platform_admin ON public.user_access_overrides;
CREATE POLICY user_access_overrides_manage_platform_admin
ON public.user_access_overrides FOR ALL
TO authenticated
USING (public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_platform_admin());

-- Platform admins need to see every user/org/community in the operator UI.
DROP POLICY IF EXISTS profiles_select_platform_admin ON public.profiles;
CREATE POLICY profiles_select_platform_admin
ON public.profiles FOR SELECT
TO authenticated
USING (public.current_user_is_platform_admin());

DROP POLICY IF EXISTS organizations_select_platform_admin ON public.organizations;
CREATE POLICY organizations_select_platform_admin
ON public.organizations FOR SELECT
TO authenticated
USING (public.current_user_is_platform_admin());

DROP POLICY IF EXISTS organization_members_select_platform_admin ON public.organization_members;
CREATE POLICY organization_members_select_platform_admin
ON public.organization_members FOR SELECT
TO authenticated
USING (public.current_user_is_platform_admin());

DROP POLICY IF EXISTS community_team_members_select_platform_admin ON public.community_team_members;
CREATE POLICY community_team_members_select_platform_admin
ON public.community_team_members FOR SELECT
TO authenticated
USING (public.current_user_is_platform_admin());

DROP POLICY IF EXISTS community_teams_select_platform_admin ON public.community_teams;
CREATE POLICY community_teams_select_platform_admin
ON public.community_teams FOR SELECT
TO authenticated
USING (public.current_user_is_platform_admin());

-- Make default signup a 7-day Pro trial for normal users/orgs. Admins bypass this through platform admin access.
UPDATE public.billing_plans
SET trial_days = 7,
    limits = COALESCE(limits, '{}'::jsonb) || '{"max_visible_opportunities":null,"opportunity_detail_cooldown_hours":0,"max_imports_per_7_days":null}'::jsonb
WHERE code IN ('starter', 'pro', 'team', 'community') OR is_public = true;

CREATE OR REPLACE FUNCTION public.ensure_organization_subscription(target_organization_id uuid, target_plan_id uuid DEFAULT NULL, target_trial_days integer DEFAULT 7)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  selected_plan_id uuid;
  selected_trial_days integer;
  existing_id uuid;
  inserted_id uuid;
BEGIN
  SELECT id INTO existing_id
  FROM public.organization_subscriptions
  WHERE organization_id = target_organization_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF existing_id IS NOT NULL THEN
    RETURN existing_id;
  END IF;

  IF target_plan_id IS NOT NULL THEN
    selected_plan_id := target_plan_id;
  ELSE
    SELECT id INTO selected_plan_id
    FROM public.billing_plans
    WHERE is_active = true AND is_public = true
    ORDER BY display_order ASC, created_at ASC
    LIMIT 1;
  END IF;

  SELECT COALESCE(NULLIF(trial_days, 0), target_trial_days, 7)
  INTO selected_trial_days
  FROM public.billing_plans
  WHERE id = selected_plan_id;

  selected_trial_days := COALESCE(selected_trial_days, 7);

  INSERT INTO public.organization_subscriptions (
    organization_id,
    plan_id,
    status,
    trial_start_at,
    trial_end_at,
    trial_source,
    notes
  ) VALUES (
    target_organization_id,
    selected_plan_id,
    CASE WHEN selected_trial_days > 0 THEN 'trialing' ELSE 'active' END,
    CASE WHEN selected_trial_days > 0 THEN now() ELSE NULL END,
    CASE WHEN selected_trial_days > 0 THEN now() + make_interval(days => selected_trial_days) ELSE NULL END,
    'signup_default_7_day_pro_trial',
    'Automatically created by signup/onboarding. Super admins bypass trial through platform admin access.'
  ) RETURNING id INTO inserted_id;

  RETURN inserted_id;
END;
$$;

CREATE TABLE IF NOT EXISTS public.user_listing_detail_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES public.market_listings(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_listing_detail_views_user_time ON public.user_listing_detail_views(user_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_listing_detail_views_listing ON public.user_listing_detail_views(listing_id, viewed_at DESC);

ALTER TABLE public.user_listing_detail_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_listing_detail_views_select_self_or_admin ON public.user_listing_detail_views;
CREATE POLICY user_listing_detail_views_select_self_or_admin
ON public.user_listing_detail_views FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS user_listing_detail_views_insert_self ON public.user_listing_detail_views;
CREATE POLICY user_listing_detail_views_insert_self
ON public.user_listing_detail_views FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());
