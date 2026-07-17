-- DealFlowIQ Batch 1 Auth/Onboarding Upgrade
-- Adds account type + organization type support for signup/onboarding.
-- Run this after 001_batch1_saas_foundation.sql.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_type text,
  ADD COLUMN IF NOT EXISTS organization_name text,
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS organization_type text NOT NULL DEFAULT 'solo_investor',
  ADD COLUMN IF NOT EXISTS account_type text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_account_type_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_account_type_check
  CHECK (
    account_type IS NULL OR account_type IN (
      'solo_investor',
      'wholesaler',
      'landlord',
      'section_8_landlord',
      'brrrr_investor',
      'fix_and_flip_investor',
      'community_guru_owner',
      'team_company'
    )
  );

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_organization_type_check;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_organization_type_check
  CHECK (
    organization_type IN (
      'solo_investor',
      'wholesaler',
      'landlord',
      'section_8_landlord',
      'brrrr_investor',
      'fix_and_flip_investor',
      'community_guru_owner',
      'team_company'
    )
  );

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_account_type_check;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_account_type_check
  CHECK (
    account_type IS NULL OR account_type IN (
      'solo_investor',
      'wholesaler',
      'landlord',
      'section_8_landlord',
      'brrrr_investor',
      'fix_and_flip_investor',
      'community_guru_owner',
      'team_company'
    )
  );

CREATE INDEX IF NOT EXISTS idx_profiles_account_type ON public.profiles(account_type);
CREATE INDEX IF NOT EXISTS idx_organizations_type ON public.organizations(organization_type);

-- Store signup metadata from Supabase Auth into public.profiles.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _account_type text := NULLIF(NEW.raw_user_meta_data->>'account_type', '');
  _organization_name text := NULLIF(NEW.raw_user_meta_data->>'organization_name', '');
BEGIN
  INSERT INTO public.profiles (id, email, full_name, account_type, organization_name, onboarding_completed)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), split_part(NEW.email, '@', 1)),
    _account_type,
    _organization_name,
    CASE WHEN _account_type IS NOT NULL THEN true ELSE false END
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), public.profiles.full_name),
    account_type = COALESCE(EXCLUDED.account_type, public.profiles.account_type),
    organization_name = COALESCE(EXCLUDED.organization_name, public.profiles.organization_name),
    onboarding_completed = public.profiles.onboarding_completed OR EXCLUDED.onboarding_completed,
    updated_at = now();

  RETURN NEW;
END;
$$;

-- Creates a default org for the logged-in user using selected signup account type.
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
