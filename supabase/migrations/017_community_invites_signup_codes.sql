-- DealFlowIQ Batch 17 — Community invite codes and member signup routing
-- Adds community teams, invite codes, optional email invite metadata, and invite-code acceptance during signup/login.

create extension if not exists pgcrypto;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pending_invite_code text;

CREATE TABLE IF NOT EXISTS public.community_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS public.community_team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.community_teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'coach', 'member', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.community_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  team_id uuid REFERENCES public.community_teams(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invite_code text NOT NULL UNIQUE,
  email text,
  full_name text,
  role public.org_member_role NOT NULL DEFAULT 'member',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'accepted', 'revoked', 'expired')),
  delivery_status text NOT NULL DEFAULT 'code_created' CHECK (delivery_status IN ('code_created', 'email_sent', 'email_failed')),
  delivery_error text,
  max_uses integer NOT NULL DEFAULT 1 CHECK (max_uses >= 1),
  accepted_count integer NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_community_teams_updated_at ON public.community_teams;
CREATE TRIGGER set_community_teams_updated_at
BEFORE UPDATE ON public.community_teams
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_community_team_members_updated_at ON public.community_team_members;
CREATE TRIGGER set_community_team_members_updated_at
BEFORE UPDATE ON public.community_team_members
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_community_invites_updated_at ON public.community_invites;
CREATE TRIGGER set_community_invites_updated_at
BEFORE UPDATE ON public.community_invites
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_community_teams_org ON public.community_teams(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_team_members_org_user ON public.community_team_members(organization_id, user_id);
CREATE INDEX IF NOT EXISTS idx_community_team_members_team ON public.community_team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_community_invites_org_created ON public.community_invites(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_invites_code ON public.community_invites(lower(invite_code));
CREATE INDEX IF NOT EXISTS idx_community_invites_email ON public.community_invites(lower(email));

ALTER TABLE public.community_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS community_teams_select_org_member ON public.community_teams;
CREATE POLICY community_teams_select_org_member
ON public.community_teams FOR SELECT
TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS community_teams_write_owner_admin ON public.community_teams;
CREATE POLICY community_teams_write_owner_admin
ON public.community_teams FOR ALL
TO authenticated
USING (public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin())
WITH CHECK (public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS community_team_members_select_org_member ON public.community_team_members;
CREATE POLICY community_team_members_select_org_member
ON public.community_team_members FOR SELECT
TO authenticated
USING (public.current_user_is_org_member(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS community_team_members_write_owner_admin ON public.community_team_members;
CREATE POLICY community_team_members_write_owner_admin
ON public.community_team_members FOR ALL
TO authenticated
USING (public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin())
WITH CHECK (public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS community_invites_select_owner_admin ON public.community_invites;
CREATE POLICY community_invites_select_owner_admin
ON public.community_invites FOR SELECT
TO authenticated
USING (public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS community_invites_write_owner_admin ON public.community_invites;
CREATE POLICY community_invites_write_owner_admin
ON public.community_invites FOR ALL
TO authenticated
USING (public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin())
WITH CHECK (public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']) OR public.current_user_is_platform_admin());

CREATE OR REPLACE FUNCTION public.normalize_invite_code(_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT upper(regexp_replace(coalesce(_code, ''), '[^a-zA-Z0-9]', '', 'g'));
$$;

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
    INSERT INTO public.community_team_members (organization_id, team_id, user_id, role)
    VALUES (_invite.organization_id, _invite.team_id, _user_id, 'member')
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

GRANT EXECUTE ON FUNCTION public.normalize_invite_code(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_community_invite(text) TO authenticated;

-- Store pending invite codes supplied during auth signup.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _account_type text := NULLIF(NEW.raw_user_meta_data->>'account_type', '');
  _organization_name text := NULLIF(NEW.raw_user_meta_data->>'organization_name', '');
  _pending_invite_code text := NULLIF(public.normalize_invite_code(NEW.raw_user_meta_data->>'invite_code'), '');
BEGIN
  INSERT INTO public.profiles (id, email, full_name, account_type, organization_name, pending_invite_code, onboarding_completed)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), split_part(NEW.email, '@', 1)),
    _account_type,
    _organization_name,
    _pending_invite_code,
    CASE WHEN _account_type IS NOT NULL OR _pending_invite_code IS NOT NULL THEN true ELSE false END
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), public.profiles.full_name),
    account_type = COALESCE(EXCLUDED.account_type, public.profiles.account_type),
    organization_name = COALESCE(EXCLUDED.organization_name, public.profiles.organization_name),
    pending_invite_code = COALESCE(EXCLUDED.pending_invite_code, public.profiles.pending_invite_code),
    onboarding_completed = public.profiles.onboarding_completed OR EXCLUDED.onboarding_completed,
    updated_at = now();

  RETURN NEW;
END;
$$;

-- Accept pending invite before creating a new standalone organization.
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
      RETURN public.accept_community_invite(_pending_invite_code);
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

  RETURN _org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_default_organization() TO authenticated;
