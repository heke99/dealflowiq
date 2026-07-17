-- DealFlowIQ Batch 1 — SaaS foundation
-- Run this in Supabase SQL Editor.

create extension if not exists pgcrypto;

-- 1) Enum types
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_member_role') THEN
    CREATE TYPE public.org_member_role AS ENUM (
      'owner',
      'admin',
      'acquisition_manager',
      'disposition_manager',
      'member',
      'buyer',
      'viewer'
    );
  END IF;
END $$;

-- 2) Core tables
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.org_member_role NOT NULL DEFAULT 'member',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  entity_type text,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3) Updated-at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_profiles_updated_at ON public.profiles;
CREATE TRIGGER set_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_organizations_updated_at ON public.organizations;
CREATE TRIGGER set_organizations_updated_at
BEFORE UPDATE ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_organization_members_updated_at ON public.organization_members;
CREATE TRIGGER set_organization_members_updated_at
BEFORE UPDATE ON public.organization_members
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4) Auth profile trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(public.profiles.full_name, EXCLUDED.full_name),
    updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 5) RLS helper functions
CREATE OR REPLACE FUNCTION public.current_user_is_org_member(_organization_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.organization_id = _organization_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.current_user_has_org_role(_organization_id uuid, _roles text[])
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.organization_id = _organization_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role::text = ANY(_roles)
  );
$$;

-- Creates a default org for the logged-in user if none exists.
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
    RETURN _existing_org_id;
  END IF;

  _base_name := COALESCE(NULLIF(split_part(_email, '@', 1), ''), 'My') || '''s Organization';
  _slug := lower(regexp_replace(COALESCE(split_part(_email, '@', 1), 'organization'), '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(_user_id::text, 1, 8);

  INSERT INTO public.organizations (name, slug, owner_id)
  VALUES (_base_name, _slug, _user_id)
  RETURNING id INTO _org_id;

  INSERT INTO public.organization_members (organization_id, user_id, role, status)
  VALUES (_org_id, _user_id, 'owner', 'active')
  ON CONFLICT (organization_id, user_id) DO UPDATE SET
    role = 'owner',
    status = 'active',
    updated_at = now();

  INSERT INTO public.audit_logs (organization_id, actor_id, event_type, entity_type, entity_id, metadata)
  VALUES (_org_id, _user_id, 'organization.created', 'organization', _org_id, jsonb_build_object('source', 'create_default_organization'));

  RETURN _org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.current_user_is_org_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_has_org_role(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_default_organization() TO authenticated;

-- 6) Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 7) Policies — profiles
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own
ON public.profiles FOR SELECT
TO authenticated
USING (id = auth.uid());

DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
CREATE POLICY profiles_insert_own
ON public.profiles FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own
ON public.profiles FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- 8) Policies — organizations
DROP POLICY IF EXISTS organizations_select_member ON public.organizations;
CREATE POLICY organizations_select_member
ON public.organizations FOR SELECT
TO authenticated
USING (owner_id = auth.uid() OR public.current_user_is_org_member(id));

DROP POLICY IF EXISTS organizations_insert_owner ON public.organizations;
CREATE POLICY organizations_insert_owner
ON public.organizations FOR INSERT
TO authenticated
WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS organizations_update_owner_admin ON public.organizations;
CREATE POLICY organizations_update_owner_admin
ON public.organizations FOR UPDATE
TO authenticated
USING (public.current_user_has_org_role(id, ARRAY['owner', 'admin']))
WITH CHECK (public.current_user_has_org_role(id, ARRAY['owner', 'admin']));

-- 9) Policies — organization_members
DROP POLICY IF EXISTS organization_members_select_same_org ON public.organization_members;
CREATE POLICY organization_members_select_same_org
ON public.organization_members FOR SELECT
TO authenticated
USING (public.current_user_is_org_member(organization_id));

DROP POLICY IF EXISTS organization_members_insert_owner_admin ON public.organization_members;
CREATE POLICY organization_members_insert_owner_admin
ON public.organization_members FOR INSERT
TO authenticated
WITH CHECK (public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']));

DROP POLICY IF EXISTS organization_members_update_owner_admin ON public.organization_members;
CREATE POLICY organization_members_update_owner_admin
ON public.organization_members FOR UPDATE
TO authenticated
USING (public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']))
WITH CHECK (public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']));

DROP POLICY IF EXISTS organization_members_delete_owner_admin ON public.organization_members;
CREATE POLICY organization_members_delete_owner_admin
ON public.organization_members FOR DELETE
TO authenticated
USING (public.current_user_has_org_role(organization_id, ARRAY['owner', 'admin']));

-- 10) Policies — audit_logs
DROP POLICY IF EXISTS audit_logs_select_org_member ON public.audit_logs;
CREATE POLICY audit_logs_select_org_member
ON public.audit_logs FOR SELECT
TO authenticated
USING (organization_id IS NULL OR public.current_user_is_org_member(organization_id));

DROP POLICY IF EXISTS audit_logs_insert_org_member ON public.audit_logs;
CREATE POLICY audit_logs_insert_org_member
ON public.audit_logs FOR INSERT
TO authenticated
WITH CHECK (organization_id IS NULL OR public.current_user_is_org_member(organization_id));

-- 11) Helpful indexes
CREATE INDEX IF NOT EXISTS idx_organization_members_user_id ON public.organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_organization_members_org_id ON public.organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_created_at ON public.audit_logs(organization_id, created_at DESC);
