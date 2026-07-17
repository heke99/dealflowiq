-- DealFlowIQ auth, onboarding and tenant reconciliation.
-- Canonicalizes the final state after the historical migrations.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Durable profile/workspace state
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active_organization_id uuid,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_skipped_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_version integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_active_organization_id_fkey'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_active_organization_id_fkey
      FOREIGN KEY (active_organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.legal_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('terms', 'privacy', 'acceptable_use')),
  document_version text NOT NULL CHECK (length(document_version) BETWEEN 1 AND 64),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ip_hash text,
  user_agent_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (user_id, document_type, document_version)
);

CREATE TABLE IF NOT EXISTS public.legal_acceptance_cutovers (
  document_type text PRIMARY KEY CHECK (document_type IN ('terms', 'privacy')),
  required_version text NOT NULL CHECK (length(required_version) BETWEEN 1 AND 64),
  required_after timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.legal_acceptance_cutovers ADD COLUMN IF NOT EXISTS required_version text;
UPDATE public.legal_acceptance_cutovers SET required_version = '2026-07-17' WHERE required_version IS NULL;
ALTER TABLE public.legal_acceptance_cutovers ALTER COLUMN required_version SET NOT NULL;

INSERT INTO public.legal_acceptance_cutovers(document_type, required_version, required_after)
VALUES ('terms', '2026-07-17', now()), ('privacy', '2026-07-17', now())
ON CONFLICT (document_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.community_invite_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id uuid NOT NULL REFERENCES public.community_invites(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id uuid REFERENCES public.community_teams(id) ON DELETE SET NULL,
  granted_role public.org_member_role NOT NULL,
  email_at_acceptance text,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invite_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  template text NOT NULL,
  recipient text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'dead_letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.auth_rate_limits (
  scope text NOT NULL,
  key_hash text NOT NULL,
  window_started_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key_hash)
);

CREATE TABLE IF NOT EXISTS public.security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  outcome text NOT NULL DEFAULT 'success' CHECK (outcome IN ('success', 'failure', 'blocked')),
  ip_hash text,
  user_agent_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_outbox ADD COLUMN IF NOT EXISTS dedupe_key text;
ALTER TABLE public.security_events ADD COLUMN IF NOT EXISTS dedupe_key text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_outbox_dedupe_key ON public.email_outbox(dedupe_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_security_events_dedupe_key ON public.security_events(dedupe_key);

CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_user_id uuid NOT NULL,
  email text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'deleted', 'failed')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_account_deletion_requests_updated_at ON public.account_deletion_requests;
CREATE TRIGGER set_account_deletion_requests_updated_at
BEFORE UPDATE ON public.account_deletion_requests
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS idx_account_deletion_one_pending
ON public.account_deletion_requests(subject_user_id)
WHERE status = 'pending';

DROP TRIGGER IF EXISTS set_email_outbox_updated_at ON public.email_outbox;
CREATE TRIGGER set_email_outbox_updated_at
BEFORE UPDATE ON public.email_outbox
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_profiles_active_organization ON public.profiles(active_organization_id);
CREATE INDEX IF NOT EXISTS idx_invite_acceptances_user ON public.community_invite_acceptances(user_id, accepted_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_outbox_delivery ON public.email_outbox(status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS idx_security_events_user_created ON public.security_events(user_id, created_at DESC);

-- Team/tenant integrity is enforced by composite foreign keys.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'community_teams_organization_id_id_key'
      AND conrelid = 'public.community_teams'::regclass
  ) THEN
    ALTER TABLE public.community_teams ADD CONSTRAINT community_teams_organization_id_id_key UNIQUE (organization_id, id);
  END IF;
END $$;

DO $$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.community_invite_acceptances'::regclass
    AND contype = 'f'
    AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (team_id)%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.community_invite_acceptances DROP CONSTRAINT %I', constraint_name);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'community_invite_acceptances_organization_team_fkey'
      AND conrelid = 'public.community_invite_acceptances'::regclass
  ) THEN
    ALTER TABLE public.community_invite_acceptances
      ADD CONSTRAINT community_invite_acceptances_organization_team_fkey
      FOREIGN KEY (organization_id, team_id)
      REFERENCES public.community_teams(organization_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.community_invites'::regclass
    AND contype = 'f'
    AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (team_id)%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.community_invites DROP CONSTRAINT %I', constraint_name);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'community_invites_organization_team_fkey'
      AND conrelid = 'public.community_invites'::regclass
  ) THEN
    ALTER TABLE public.community_invites
      ADD CONSTRAINT community_invites_organization_team_fkey
      FOREIGN KEY (organization_id, team_id)
      REFERENCES public.community_teams(organization_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.community_team_members'::regclass
    AND contype = 'f'
    AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (team_id)%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.community_team_members DROP CONSTRAINT %I', constraint_name);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'community_team_members_organization_team_fkey'
      AND conrelid = 'public.community_team_members'::regclass
  ) THEN
    ALTER TABLE public.community_team_members
      ADD CONSTRAINT community_team_members_organization_team_fkey
      FOREIGN KEY (organization_id, team_id)
      REFERENCES public.community_teams(organization_id, id) ON DELETE CASCADE;
  END IF;
END $$;

UPDATE public.community_invites SET max_uses = greatest(1, least(500, max_uses)), accepted_count = greatest(0, least(accepted_count, greatest(1, least(500, max_uses))));
UPDATE public.community_invites SET expires_at = created_at + interval '1 day' WHERE expires_at IS NOT NULL AND expires_at <= created_at;
ALTER TABLE public.community_invites DROP CONSTRAINT IF EXISTS community_invites_usage_check;
ALTER TABLE public.community_invites ADD CONSTRAINT community_invites_usage_check
  CHECK (max_uses BETWEEN 1 AND 500 AND accepted_count BETWEEN 0 AND max_uses);
ALTER TABLE public.community_invites DROP CONSTRAINT IF EXISTS community_invites_expiry_check;
ALTER TABLE public.community_invites ADD CONSTRAINT community_invites_expiry_check
  CHECK (expires_at IS NULL OR expires_at > created_at);

UPDATE public.admin_access_invites
SET trial_days = greatest(0, least(3650, coalesce(trial_days, 0))),
    expires_at = created_at + interval '30 days'
WHERE trial_days IS NULL OR trial_days < 0 OR trial_days > 3650
   OR (expires_at IS NOT NULL AND expires_at <= created_at);
ALTER TABLE public.admin_access_invites DROP CONSTRAINT IF EXISTS admin_access_invites_trial_days_check;
ALTER TABLE public.admin_access_invites ADD CONSTRAINT admin_access_invites_trial_days_check
  CHECK (trial_days BETWEEN 0 AND 3650);
ALTER TABLE public.admin_access_invites DROP CONSTRAINT IF EXISTS admin_access_invites_expiry_check;
ALTER TABLE public.admin_access_invites ADD CONSTRAINT admin_access_invites_expiry_check
  CHECK (expires_at IS NULL OR expires_at > created_at);

ALTER TABLE public.community_invites DROP CONSTRAINT IF EXISTS community_invites_delivery_status_check;
ALTER TABLE public.community_invites ADD CONSTRAINT community_invites_delivery_status_check
  CHECK (delivery_status IN ('code_created', 'email_queued', 'email_sent', 'email_failed'));

-- Owner deletion must be an explicit business operation, never an auth cascade.
DO $$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.organizations'::regclass
    AND contype = 'f'
    AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (owner_id)%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.organizations DROP CONSTRAINT %I', constraint_name);
  END IF;
  ALTER TABLE public.organizations
    ADD CONSTRAINT organizations_owner_id_fkey
    FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.organization_role_rank(_role text)
RETURNS integer LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE _role
    WHEN 'owner' THEN 100
    WHEN 'admin' THEN 80
    WHEN 'acquisition_manager' THEN 60
    WHEN 'disposition_manager' THEN 60
    WHEN 'buyer' THEN 40
    WHEN 'member' THEN 30
    WHEN 'viewer' THEN 10
    ELSE 0 END;
$$;

CREATE OR REPLACE FUNCTION public.team_role_rank(_role text)
RETURNS integer LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE _role
    WHEN 'owner' THEN 100
    WHEN 'admin' THEN 80
    WHEN 'coach' THEN 60
    WHEN 'member' THEN 30
    WHEN 'viewer' THEN 10
    ELSE 0 END;
$$;

CREATE OR REPLACE FUNCTION public.current_user_has_required_legal_acceptance()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.legal_acceptance_cutovers cutover
    JOIN auth.users account ON account.id = auth.uid()
    WHERE account.created_at >= cutover.required_after
      AND NOT EXISTS (
        SELECT 1
        FROM public.legal_acceptances acceptance
        WHERE acceptance.user_id = account.id
          AND acceptance.document_type = cutover.document_type
          AND acceptance.document_version = cutover.required_version
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.consume_auth_rate_limit(
  _scope text,
  _key_hash text,
  _limit integer,
  _window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _row public.auth_rate_limits%ROWTYPE;
  _now timestamptz := clock_timestamp();
BEGIN
  IF length(coalesce(_scope, '')) NOT BETWEEN 1 AND 80
    OR length(coalesce(_key_hash, '')) NOT BETWEEN 16 AND 128
    OR _limit NOT BETWEEN 1 AND 1000
    OR _window_seconds NOT BETWEEN 60 AND 86400 THEN
    RAISE EXCEPTION 'RATE_LIMIT_INVALID';
  END IF;

  INSERT INTO public.auth_rate_limits(scope, key_hash, window_started_at, attempts)
  VALUES (_scope, _key_hash, _now, 1)
  ON CONFLICT (scope, key_hash) DO UPDATE SET
    window_started_at = CASE
      WHEN public.auth_rate_limits.window_started_at + make_interval(secs => _window_seconds) <= _now THEN _now
      ELSE public.auth_rate_limits.window_started_at END,
    attempts = CASE
      WHEN public.auth_rate_limits.window_started_at + make_interval(secs => _window_seconds) <= _now THEN 1
      ELSE public.auth_rate_limits.attempts + 1 END,
    updated_at = _now
  RETURNING * INTO _row;

  RETURN _row.attempts <= _limit;
END;
$$;

-- ---------------------------------------------------------------------------
-- Minimal, unprivileged auth trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _full_name text := left(nullif(btrim(coalesce(NEW.raw_user_meta_data->>'full_name', '')), ''), 120);
  _account_type text := NULL; -- Privileged plan/account selection is written only by the validated server signup action.
  _organization_name text := NULL;
  _pending_invite_code text := NULL;
BEGIN
  INSERT INTO public.profiles (
    id, email, full_name, account_type, organization_name, pending_invite_code,
    onboarding_completed, onboarding_completed_at, onboarding_skipped_at, onboarding_version
  ) VALUES (
    NEW.id,
    lower(NEW.email),
    coalesce(_full_name, left(split_part(NEW.email, '@', 1), 120)),
    _account_type,
    _organization_name,
    _pending_invite_code,
    false,
    NULL,
    NULL,
    1
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = coalesce(public.profiles.full_name, EXCLUDED.full_name),
    account_type = coalesce(public.profiles.account_type, EXCLUDED.account_type),
    organization_name = coalesce(public.profiles.organization_name, EXCLUDED.organization_name),
    pending_invite_code = coalesce(public.profiles.pending_invite_code, EXCLUDED.pending_invite_code),
    updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Invite validation, creation and idempotent acceptance
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_community_invite(_invite_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  _code text := public.normalize_invite_code(_invite_code);
  _invite public.community_invites%ROWTYPE;
  _organization_name text;
  _team_name text;
BEGIN
  SELECT * INTO _invite FROM public.community_invites
  WHERE invite_code = _code
  ORDER BY created_at DESC LIMIT 1;

  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'INVITE_INVALID'); END IF;
  IF _invite.status = 'revoked' THEN RETURN jsonb_build_object('status', 'INVITE_REVOKED'); END IF;
  IF _invite.expires_at IS NOT NULL AND _invite.expires_at <= now() THEN RETURN jsonb_build_object('status', 'INVITE_EXPIRED'); END IF;
  IF _invite.status = 'accepted' OR _invite.accepted_count >= _invite.max_uses THEN RETURN jsonb_build_object('status', 'INVITE_ALREADY_USED'); END IF;
  IF _invite.status <> 'active' THEN RETURN jsonb_build_object('status', 'INVITE_INVALID'); END IF;

  SELECT name INTO _organization_name FROM public.organizations WHERE id = _invite.organization_id;
  SELECT name INTO _team_name FROM public.community_teams
    WHERE organization_id = _invite.organization_id AND id = _invite.team_id;

  RETURN jsonb_build_object(
    'status', 'ACTIVE',
    'organization_name', _organization_name,
    'team_name', _team_name,
    'role', _invite.role::text,
    'email_restricted', _invite.email IS NOT NULL,
    'expires_at', _invite.expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_community_invite(
  _email text DEFAULT NULL,
  _full_name text DEFAULT NULL,
  _team_id uuid DEFAULT NULL,
  _role text DEFAULT 'member',
  _max_uses integer DEFAULT 1,
  _expires_in_days integer DEFAULT 14,
  _queue_email boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _organization_id uuid;
  _actor_role text;
  _invite_id uuid;
  _invite_code text := upper(encode(gen_random_bytes(16), 'hex'));
  _expires_at timestamptz;
  _normalized_email text := nullif(lower(btrim(coalesce(_email, ''))), '');
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF _max_uses NOT BETWEEN 1 AND 500 OR _expires_in_days NOT BETWEEN 1 AND 365 THEN RAISE EXCEPTION 'INVITE_INVALID_NUMERIC_FIELDS'; END IF;
  IF _normalized_email IS NOT NULL AND _normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN RAISE EXCEPTION 'INVITE_INVALID_EMAIL'; END IF;

  SELECT p.active_organization_id INTO _organization_id FROM public.profiles p WHERE p.id = _user_id;
  SELECT om.role::text INTO _actor_role FROM public.organization_members om
    WHERE om.organization_id = _organization_id AND om.user_id = _user_id AND om.status = 'active';
  IF _actor_role NOT IN ('owner','admin') AND NOT public.current_user_is_platform_admin() THEN RAISE EXCEPTION 'WORKSPACE_ACCESS_DENIED'; END IF;
  IF _role = 'owner' THEN RAISE EXCEPTION 'OWNERSHIP_TRANSFER_REQUIRED'; END IF;
  IF _role NOT IN ('admin','acquisition_manager','disposition_manager','member','buyer','viewer') THEN RAISE EXCEPTION 'INVITE_INVALID_ROLE'; END IF;

  IF _team_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.community_teams WHERE organization_id = _organization_id AND id = _team_id
  ) THEN RAISE EXCEPTION 'INVITE_TEAM_MISMATCH'; END IF;

  IF (SELECT count(*) FROM public.community_invites WHERE organization_id = _organization_id AND created_at >= now() - interval '24 hours') >= 20 THEN
    RAISE EXCEPTION 'RATE_LIMITED';
  END IF;

  _expires_at := now() + make_interval(days => _expires_in_days);
  INSERT INTO public.community_invites(
    organization_id, team_id, created_by, invite_code, email, full_name, role,
    max_uses, expires_at, metadata
  ) VALUES (
    _organization_id, _team_id, _user_id, _invite_code, _normalized_email,
    left(nullif(btrim(coalesce(_full_name,'')), ''), 120), _role::public.org_member_role,
    _max_uses, _expires_at,
    jsonb_build_object('created_from', 'community_page')
  ) RETURNING id INTO _invite_id;

  IF _queue_email AND _normalized_email IS NOT NULL THEN
    UPDATE public.community_invites SET delivery_status = 'email_queued', updated_at = now() WHERE id = _invite_id;
    INSERT INTO public.email_outbox(organization_id, template, recipient, payload)
    VALUES (_organization_id, 'community_invite', _normalized_email,
      jsonb_build_object('invite_id', _invite_id, 'invite_code', _invite_code));
  END IF;

  INSERT INTO public.audit_logs(organization_id, actor_id, event_type, entity_type, entity_id, metadata)
  VALUES (_organization_id, _user_id, 'community_invite.created', 'community_invite', _invite_id,
    jsonb_build_object('email', _normalized_email, 'team_id', _team_id, 'role', _role, 'max_uses', _max_uses));

  RETURN jsonb_build_object('id', _invite_id, 'invite_code', _invite_code, 'expires_at', _expires_at, 'organization_id', _organization_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_community_invite(_invite_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _organization_id uuid;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT organization_id INTO _organization_id
  FROM public.community_invites
  WHERE id = _invite_id
  FOR UPDATE;
  IF _organization_id IS NULL THEN RAISE EXCEPTION 'INVITE_INVALID'; END IF;
  IF NOT public.current_user_has_org_role(_organization_id, ARRAY['owner','admin'])
    AND NOT public.current_user_is_platform_admin() THEN
    RAISE EXCEPTION 'WORKSPACE_ACCESS_DENIED';
  END IF;
  UPDATE public.community_invites
  SET status = 'revoked', updated_at = now()
  WHERE id = _invite_id AND status IN ('active','expired');
  INSERT INTO public.audit_logs(organization_id,actor_id,event_type,entity_type,entity_id,metadata)
  VALUES (_organization_id,_user_id,'community_invite.revoked','community_invite',_invite_id,'{}'::jsonb);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_community_invite(_invite_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _email text := lower(coalesce(auth.email(), ''));
  _code text := public.normalize_invite_code(_invite_code);
  _invite public.community_invites%ROWTYPE;
  _existing_role text;
  _team_role text;
  _existing_team_role text;
  _inserted_id uuid;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT public.current_user_has_required_legal_acceptance() THEN RAISE EXCEPTION 'LEGAL_ACCEPTANCE_REQUIRED'; END IF;
  IF length(coalesce(_code,'')) < 4 THEN RAISE EXCEPTION 'INVITE_INVALID'; END IF;
  IF NOT public.consume_auth_rate_limit(
    'invite.accept.db',
    encode(digest(_user_id::text || ':' || _code, 'sha256'), 'hex'),
    20,
    900
  ) THEN RAISE EXCEPTION 'RATE_LIMITED'; END IF;

  INSERT INTO public.profiles(id,email,full_name,onboarding_completed)
  VALUES (_user_id,_email,left(coalesce(nullif(split_part(_email,'@',1),''),'User'),120),false)
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, updated_at = now();

  SELECT * INTO _invite FROM public.community_invites
  WHERE invite_code = _code ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVITE_INVALID'; END IF;

  IF EXISTS (SELECT 1 FROM public.community_invite_acceptances WHERE invite_id = _invite.id AND user_id = _user_id) THEN
    UPDATE public.profiles SET active_organization_id = _invite.organization_id, pending_invite_code = NULL, updated_at = now() WHERE id = _user_id;
    RETURN _invite.organization_id;
  END IF;

  IF _invite.status = 'revoked' THEN RAISE EXCEPTION 'INVITE_REVOKED'; END IF;
  IF _invite.expires_at IS NOT NULL AND _invite.expires_at <= now() THEN RAISE EXCEPTION 'INVITE_EXPIRED'; END IF;
  IF _invite.status <> 'active' OR _invite.accepted_count >= _invite.max_uses THEN RAISE EXCEPTION 'INVITE_ALREADY_USED'; END IF;
  IF _invite.email IS NOT NULL AND lower(_invite.email) <> _email THEN RAISE EXCEPTION 'INVITE_EMAIL_MISMATCH'; END IF;
  IF _invite.role::text = 'owner' THEN RAISE EXCEPTION 'OWNERSHIP_TRANSFER_REQUIRED'; END IF;
  IF _invite.team_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.community_teams WHERE organization_id = _invite.organization_id AND id = _invite.team_id
  ) THEN RAISE EXCEPTION 'INVITE_TEAM_MISMATCH'; END IF;

  SELECT role::text INTO _existing_role FROM public.organization_members
    WHERE organization_id = _invite.organization_id AND user_id = _user_id FOR UPDATE;

  IF _existing_role IS NULL THEN
    INSERT INTO public.organization_members(organization_id, user_id, role, status)
    VALUES (_invite.organization_id, _user_id, _invite.role, 'active');
  ELSE
    UPDATE public.organization_members SET
      role = CASE WHEN public.organization_role_rank(_invite.role::text) > public.organization_role_rank(_existing_role)
        THEN _invite.role ELSE _existing_role::public.org_member_role END,
      status = 'active', updated_at = now()
    WHERE organization_id = _invite.organization_id AND user_id = _user_id;
  END IF;

  IF _invite.team_id IS NOT NULL THEN
    _team_role := CASE _invite.role::text
      WHEN 'owner' THEN 'owner' WHEN 'admin' THEN 'admin' WHEN 'viewer' THEN 'viewer' ELSE 'member' END;
    SELECT role INTO _existing_team_role FROM public.community_team_members
      WHERE organization_id = _invite.organization_id AND team_id = _invite.team_id AND user_id = _user_id FOR UPDATE;
    INSERT INTO public.community_team_members(organization_id, team_id, user_id, role)
    VALUES (_invite.organization_id, _invite.team_id, _user_id,
      CASE WHEN _existing_team_role IS NOT NULL AND public.team_role_rank(_existing_team_role) > public.team_role_rank(_team_role)
        THEN _existing_team_role ELSE _team_role END)
    ON CONFLICT (team_id, user_id) DO UPDATE SET
      role = CASE WHEN public.team_role_rank(public.community_team_members.role) > public.team_role_rank(EXCLUDED.role)
        THEN public.community_team_members.role ELSE EXCLUDED.role END,
      updated_at = now();
  END IF;

  INSERT INTO public.community_invite_acceptances(invite_id, organization_id, user_id, team_id, granted_role, email_at_acceptance)
  VALUES (_invite.id, _invite.organization_id, _user_id, _invite.team_id, _invite.role, _email)
  ON CONFLICT (invite_id, user_id) DO NOTHING
  RETURNING id INTO _inserted_id;

  IF _inserted_id IS NOT NULL THEN
    UPDATE public.community_invites SET
      accepted_count = accepted_count + 1,
      accepted_by = _user_id,
      accepted_at = now(),
      status = CASE WHEN accepted_count + 1 >= max_uses THEN 'accepted' ELSE 'active' END,
      updated_at = now()
    WHERE id = _invite.id;
  END IF;

  UPDATE public.profiles SET active_organization_id = _invite.organization_id,
    pending_invite_code = NULL, updated_at = now() WHERE id = _user_id;

  INSERT INTO public.audit_logs(organization_id, actor_id, event_type, entity_type, entity_id, metadata)
  VALUES (_invite.organization_id, _user_id, 'community_invite.accepted', 'community_invite', _invite.id,
    jsonb_build_object('team_id', _invite.team_id, 'role', _invite.role::text, 'idempotent', _inserted_id IS NULL));

  RETURN _invite.organization_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Internal subscription/admin invite functions and explicit bootstrap
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_organization_subscription_internal(_organization_id uuid, _account_type text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _existing public.organization_subscriptions%ROWTYPE;
  _plan_id uuid;
  _trial_days integer;
  _trial_end timestamptz;
  _subscription_id uuid;
BEGIN
  SELECT * INTO _existing FROM public.organization_subscriptions WHERE organization_id = _organization_id FOR UPDATE;
  IF FOUND THEN RETURN _existing.id; END IF;

  _plan_id := public.default_plan_for_account_type(coalesce(_account_type, 'solo_investor'));
  SELECT coalesce(trial_days, 7) INTO _trial_days FROM public.billing_plans WHERE id = _plan_id;
  _trial_days := coalesce(_trial_days, 7);
  _trial_end := CASE WHEN _trial_days > 0 THEN now() + make_interval(days => _trial_days) END;

  INSERT INTO public.organization_subscriptions(
    organization_id, plan_id, status, trial_start_at, trial_end_at,
    current_period_start, current_period_end, trial_source, notes
  ) VALUES (
    _organization_id, _plan_id, CASE WHEN _trial_days > 0 THEN 'trialing' ELSE 'active' END,
    CASE WHEN _trial_days > 0 THEN now() END, _trial_end, now(), _trial_end,
    'plan_default', 'Created atomically during organization bootstrap.'
  ) RETURNING id INTO _subscription_id;

  INSERT INTO public.audit_logs(organization_id, actor_id, event_type, entity_type, entity_id, metadata)
  VALUES (_organization_id, auth.uid(), 'subscription.created', 'organization_subscription', _subscription_id,
    jsonb_build_object('source','bootstrap','account_type',_account_type,'trial_days',_trial_days));
  RETURN _subscription_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_admin_access_invite_internal(_bootstrap_organization_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _email text := lower(coalesce(auth.email(),''));
  _invite public.admin_access_invites%ROWTYPE;
  _target_organization_id uuid;
  _plan_id uuid;
  _period_end timestamptz;
  _base_name text;
  _slug text;
  _paid_subscription_exists boolean := false;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  SELECT * INTO _invite FROM public.admin_access_invites
  WHERE lower(email) = _email AND status = 'active'
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF _invite.expires_at IS NOT NULL AND _invite.expires_at <= now() THEN
    UPDATE public.admin_access_invites SET status = 'expired', updated_at = now() WHERE id = _invite.id;
    RETURN NULL;
  END IF;

  _target_organization_id := coalesce(_invite.organization_id, _bootstrap_organization_id);
  IF _invite.organization_id IS NOT NULL AND _invite.role::text = 'owner' THEN
    RAISE EXCEPTION 'OWNERSHIP_TRANSFER_REQUIRED';
  END IF;
  IF _target_organization_id IS NULL THEN
    IF _invite.role::text <> 'owner' THEN RAISE EXCEPTION 'ADMIN_INVITE_NEW_ORG_REQUIRES_OWNER'; END IF;
    _base_name := coalesce(nullif(btrim(_invite.organization_name),''), coalesce(nullif(split_part(_email,'@',1),''),'Workspace') || '''s Workspace');
    _slug := trim(both '-' from lower(regexp_replace(_base_name,'[^a-zA-Z0-9]+','-','g'))) || '-' || substr(_user_id::text,1,8);
    INSERT INTO public.organizations(name,slug,owner_id,organization_type,account_type)
    VALUES (_base_name,_slug,_user_id,_invite.account_type,_invite.account_type)
    RETURNING id INTO _target_organization_id;
  ELSIF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = _target_organization_id FOR UPDATE) THEN
    RAISE EXCEPTION 'ADMIN_INVITE_TARGET_INVALID';
  END IF;

  INSERT INTO public.organization_members(organization_id, user_id, role, status)
  VALUES (_target_organization_id, _user_id, _invite.role, 'active')
  ON CONFLICT (organization_id, user_id) DO UPDATE SET
    role = CASE WHEN public.organization_role_rank(EXCLUDED.role::text) > public.organization_role_rank(public.organization_members.role::text)
      THEN EXCLUDED.role ELSE public.organization_members.role END,
    status = 'active', updated_at = now();

  UPDATE public.organizations SET
    name = coalesce(nullif(_invite.organization_name,''), name),
    organization_type = _invite.account_type,
    account_type = _invite.account_type,
    updated_at = now()
  WHERE id = _target_organization_id;

  UPDATE public.profiles SET account_type = _invite.account_type,
    organization_name = coalesce(nullif(_invite.organization_name,''), organization_name),
    active_organization_id = _target_organization_id,
    updated_at = now()
  WHERE id = _user_id;

  SELECT EXISTS (
    SELECT 1 FROM public.organization_subscriptions
    WHERE organization_id = _target_organization_id
      AND stripe_subscription_id IS NOT NULL
      AND status IN ('trialing','active','past_due')
  ) INTO _paid_subscription_exists;

  IF NOT _paid_subscription_exists THEN
    _plan_id := coalesce(_invite.plan_id, public.default_plan_for_account_type(_invite.account_type));
    _period_end := CASE WHEN coalesce(_invite.trial_days,0) > 0 THEN now() + make_interval(days => _invite.trial_days) END;
    INSERT INTO public.organization_subscriptions(
      organization_id, plan_id, status, trial_start_at, trial_end_at, current_period_start,
      current_period_end, trial_source, features_override, limits_override, notes, manually_granted_by
    ) VALUES (
      _target_organization_id, _plan_id,
      CASE WHEN coalesce(_invite.trial_days,0) > 0 THEN 'trialing' ELSE 'manually_granted' END,
      CASE WHEN coalesce(_invite.trial_days,0) > 0 THEN now() END, _period_end, now(), _period_end,
      'invite_override', coalesce(_invite.features_override,'{}'::jsonb), coalesce(_invite.limits_override,'{}'::jsonb),
      coalesce(_invite.notes,'Admin invite access applied.'), _invite.created_by
    ) ON CONFLICT (organization_id) DO UPDATE SET
      plan_id = EXCLUDED.plan_id, status = EXCLUDED.status, trial_start_at = EXCLUDED.trial_start_at,
      trial_end_at = EXCLUDED.trial_end_at, current_period_start = EXCLUDED.current_period_start,
      current_period_end = EXCLUDED.current_period_end, trial_source = EXCLUDED.trial_source,
      features_override = EXCLUDED.features_override, limits_override = EXCLUDED.limits_override,
      notes = EXCLUDED.notes, manually_granted_by = EXCLUDED.manually_granted_by, updated_at = now();
  END IF;

  UPDATE public.admin_access_invites SET status = 'used', invited_user_id = _user_id,
    organization_id = _target_organization_id, used_at = now(), updated_at = now() WHERE id = _invite.id;
  INSERT INTO public.audit_logs(organization_id, actor_id, event_type, entity_type, entity_id, metadata)
  VALUES (_target_organization_id, _user_id, 'admin_access_invite.applied', 'admin_access_invite', _invite.id,
    jsonb_build_object('account_type',_invite.account_type,'trial_days',_invite.trial_days,'preserved_paid_subscription',_paid_subscription_exists));
  RETURN _invite.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.bootstrap_current_user(_invite_code text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _email text := lower(coalesce(auth.email(),''));
  _profile public.profiles%ROWTYPE;
  _organization_id uuid;
  _code text;
  _base_name text;
  _slug text;
  _created_organization boolean := false;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_user_id::text, 20260717));
  IF NOT public.current_user_has_required_legal_acceptance() THEN
    RAISE EXCEPTION 'LEGAL_ACCEPTANCE_REQUIRED';
  END IF;

  INSERT INTO public.profiles(id,email,full_name,onboarding_completed)
  VALUES (_user_id,_email,left(coalesce(nullif(split_part(_email,'@',1),''),'User'),120),false)
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, updated_at = now();
  SELECT * INTO _profile FROM public.profiles WHERE id = _user_id FOR UPDATE;

  _code := coalesce(nullif(public.normalize_invite_code(_invite_code),''), _profile.pending_invite_code);
  IF _code IS NOT NULL THEN
    _organization_id := public.accept_community_invite(_code);
  ELSE
    -- An explicit admin target wins over a default or oldest workspace.
    PERFORM public.apply_admin_access_invite_internal(NULL);
    SELECT p.active_organization_id INTO _organization_id FROM public.profiles p WHERE p.id = _user_id;

    IF _organization_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.organization_members
      WHERE organization_id = _organization_id AND user_id = _user_id AND status = 'active'
    ) THEN
      SELECT om.organization_id INTO _organization_id
      FROM public.organization_members om
      WHERE om.user_id = _user_id AND om.status = 'active'
      ORDER BY om.created_at ASC LIMIT 1;
    END IF;

    IF _organization_id IS NULL THEN
      _base_name := coalesce(nullif(_profile.organization_name,''),
        coalesce(nullif(split_part(_email,'@',1),''),'My') || '''s Workspace');
      _slug := trim(both '-' from lower(regexp_replace(_base_name,'[^a-zA-Z0-9]+','-','g')))
        || '-' || substr(_user_id::text,1,8);
      INSERT INTO public.organizations(name,slug,owner_id,organization_type,account_type)
      VALUES (_base_name,_slug,_user_id,coalesce(_profile.account_type,'solo_investor'),coalesce(_profile.account_type,'solo_investor'))
      RETURNING id INTO _organization_id;
      _created_organization := true;
      INSERT INTO public.organization_members(organization_id,user_id,role,status)
      VALUES (_organization_id,_user_id,'owner','active');
      INSERT INTO public.audit_logs(organization_id,actor_id,event_type,entity_type,entity_id,metadata)
      VALUES (_organization_id,_user_id,'organization.created','organization',_organization_id,jsonb_build_object('source','bootstrap_current_user'));
    END IF;
  END IF;

  IF _created_organization THEN
    PERFORM public.ensure_organization_subscription_internal(_organization_id, coalesce(_profile.account_type,'solo_investor'));
  END IF;
  UPDATE public.profiles SET active_organization_id = _organization_id, updated_at = now() WHERE id = _user_id;
  RETURN jsonb_build_object('organization_id',_organization_id,'onboarding_completed',_profile.onboarding_completed);
END;
$$;

-- Compatibility wrapper. Reads must never call this function.
CREATE OR REPLACE FUNCTION public.create_default_organization()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE _result jsonb;
BEGIN
  _result := public.bootstrap_current_user(NULL);
  RETURN (_result->>'organization_id')::uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_active_organization(_organization_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE _user_id uuid := auth.uid();
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = _organization_id AND user_id = _user_id AND status = 'active') THEN
    RAISE EXCEPTION 'WORKSPACE_ACCESS_DENIED';
  END IF;
  UPDATE public.profiles SET active_organization_id = _organization_id, updated_at = now() WHERE id = _user_id;
  INSERT INTO public.audit_logs(organization_id,actor_id,event_type,entity_type,entity_id,metadata)
  VALUES (_organization_id,_user_id,'workspace.switched','organization',_organization_id,'{}'::jsonb);
  RETURN _organization_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_organization_subscription(_organization_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE _account_type text;
BEGIN
  IF NOT public.current_user_has_org_role(_organization_id, ARRAY['owner']) AND NOT public.current_user_is_platform_admin() THEN
    RAISE EXCEPTION 'WORKSPACE_ACCESS_DENIED';
  END IF;
  SELECT coalesce(account_type,organization_type,'solo_investor') INTO _account_type FROM public.organizations WHERE id = _organization_id;
  RETURN public.ensure_organization_subscription_internal(_organization_id,_account_type);
END;
$$;

-- ---------------------------------------------------------------------------
-- Atomic onboarding and settings
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_user_onboarding(
  _full_name text,
  _account_type text,
  _workspace_name text,
  _primary_market text,
  _primary_strategy text,
  _onboarding_version integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE _user_id uuid := auth.uid(); _organization_id uuid; _role text;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF length(btrim(coalesce(_full_name,''))) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'ONBOARDING_INVALID_NAME'; END IF;
  IF _account_type <> ALL(ARRAY['solo_investor','wholesaler','landlord','section_8_landlord','brrrr_investor','fix_and_flip_investor','community_guru_owner','team_company']) THEN RAISE EXCEPTION 'ONBOARDING_INVALID_ACCOUNT_TYPE'; END IF;
  IF _primary_strategy IS NOT NULL AND _primary_strategy <> ALL(ARRAY['buy_and_hold','section8','brrrr','fix_and_flip','wholesale','seller_finance','mixed']) THEN RAISE EXCEPTION 'ONBOARDING_INVALID_STRATEGY'; END IF;
  SELECT p.active_organization_id INTO _organization_id FROM public.profiles p WHERE p.id = _user_id FOR UPDATE;
  SELECT role::text INTO _role FROM public.organization_members WHERE organization_id = _organization_id AND user_id = _user_id AND status = 'active';
  IF _organization_id IS NULL OR _role IS NULL THEN RAISE EXCEPTION 'WORKSPACE_BOOTSTRAP_REQUIRED'; END IF;

  UPDATE public.profiles SET
    full_name = left(nullif(btrim(coalesce(_full_name,'')),''),120), account_type = _account_type,
    onboarding_completed = true, onboarding_completed_at = now(), onboarding_skipped_at = NULL,
    onboarding_version = greatest(1,coalesce(_onboarding_version,1)), updated_at = now()
  WHERE id = _user_id;

  IF _role IN ('owner','admin') THEN
    UPDATE public.organizations SET
      name = coalesce(left(nullif(btrim(coalesce(_workspace_name,'')),''),120),name),
      primary_market = left(nullif(btrim(coalesce(_primary_market,'')),''),120),
      primary_strategy = _primary_strategy, account_type = _account_type, updated_at = now()
    WHERE id = _organization_id;
  END IF;

  INSERT INTO public.audit_logs(organization_id,actor_id,event_type,entity_type,entity_id,metadata)
  VALUES (_organization_id,_user_id,'onboarding.completed','profile',_user_id,
    jsonb_build_object('account_type',_account_type,'primary_market',_primary_market,'primary_strategy',_primary_strategy,'version',_onboarding_version));
  RETURN jsonb_build_object('organization_id',_organization_id,'completed',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.skip_user_onboarding(_onboarding_version integer DEFAULT 1)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE _user_id uuid := auth.uid(); _organization_id uuid;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  UPDATE public.profiles SET onboarding_completed = true, onboarding_completed_at = NULL,
    onboarding_skipped_at = now(), onboarding_version = greatest(1,coalesce(_onboarding_version,1)), updated_at = now()
  WHERE id = _user_id RETURNING active_organization_id INTO _organization_id;
  IF NOT FOUND OR _organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = _organization_id AND user_id = _user_id AND status = 'active'
  ) THEN RAISE EXCEPTION 'WORKSPACE_BOOTSTRAP_REQUIRED'; END IF;
  INSERT INTO public.audit_logs(organization_id,actor_id,event_type,entity_type,entity_id,metadata)
  VALUES (_organization_id,_user_id,'onboarding.skipped','profile',_user_id,jsonb_build_object('version',_onboarding_version));
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_user_workspace_settings(
  _full_name text,
  _account_type text,
  _workspace_name text,
  _primary_market text,
  _primary_strategy text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE _user_id uuid := auth.uid(); _organization_id uuid; _role text;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF length(btrim(coalesce(_full_name,''))) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'SETTINGS_INVALID_NAME'; END IF;
  IF _account_type <> ALL(ARRAY['solo_investor','wholesaler','landlord','section_8_landlord','brrrr_investor','fix_and_flip_investor','community_guru_owner','team_company']) THEN RAISE EXCEPTION 'SETTINGS_INVALID_ACCOUNT_TYPE'; END IF;
  IF _primary_strategy IS NOT NULL AND _primary_strategy <> ALL(ARRAY['buy_and_hold','section8','brrrr','fix_and_flip','wholesale','seller_finance','mixed']) THEN RAISE EXCEPTION 'SETTINGS_INVALID_STRATEGY'; END IF;
  SELECT active_organization_id INTO _organization_id FROM public.profiles WHERE id = _user_id FOR UPDATE;
  SELECT role::text INTO _role FROM public.organization_members WHERE organization_id = _organization_id AND user_id = _user_id AND status = 'active';
  IF _organization_id IS NULL OR _role IS NULL THEN RAISE EXCEPTION 'WORKSPACE_ACCESS_DENIED'; END IF;
  UPDATE public.profiles SET full_name = left(btrim(_full_name),120), account_type = _account_type, updated_at = now() WHERE id = _user_id;
  IF _role IN ('owner','admin') THEN
    IF length(btrim(coalesce(_workspace_name,''))) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'SETTINGS_INVALID_WORKSPACE'; END IF;
    UPDATE public.organizations SET name = left(btrim(_workspace_name),120), account_type = _account_type,
      primary_market = left(nullif(btrim(coalesce(_primary_market,'')),''),120), primary_strategy = _primary_strategy, updated_at = now()
    WHERE id = _organization_id;
  END IF;
  INSERT INTO public.audit_logs(organization_id,actor_id,event_type,entity_type,entity_id,metadata)
  VALUES (_organization_id,_user_id,'settings.updated','profile',_user_id,jsonb_build_object('account_type',_account_type));
  RETURN jsonb_build_object('organization_id',_organization_id,'updated',true);
END;
$$;

DROP FUNCTION IF EXISTS public.record_password_change();
DROP FUNCTION IF EXISTS public.record_password_change_event(uuid);

CREATE OR REPLACE FUNCTION public.record_password_change_event(
  _subject_user_id uuid,
  _event_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _email text;
  _organization_id uuid;
  _dedupe_key text;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' THEN RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'; END IF;
  IF _subject_user_id IS NULL OR _event_id IS NULL THEN RAISE EXCEPTION 'PASSWORD_EVENT_INVALID'; END IF;

  SELECT lower(email) INTO _email FROM auth.users WHERE id = _subject_user_id;
  IF _email IS NULL OR _email = '' THEN RAISE EXCEPTION 'PASSWORD_EVENT_USER_INVALID'; END IF;
  _dedupe_key := 'password_changed:' || _event_id::text;

  SELECT active_organization_id INTO _organization_id FROM public.profiles WHERE id = _subject_user_id;
  INSERT INTO public.security_events(user_id,organization_id,event_type,outcome,dedupe_key,metadata)
  VALUES (_subject_user_id,_organization_id,'password.changed','success',_dedupe_key,jsonb_build_object('event_id',_event_id))
  ON CONFLICT (dedupe_key) DO NOTHING;
  INSERT INTO public.email_outbox(organization_id,template,recipient,dedupe_key,payload)
  VALUES (_organization_id,'password_changed',_email,_dedupe_key,jsonb_build_object('user_id',_subject_user_id,'event_id',_event_id))
  ON CONFLICT (dedupe_key) DO NOTHING;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_email_outbox(_batch_size integer DEFAULT 20)
RETURNS SETOF public.email_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'; END IF;
  IF _batch_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'OUTBOX_BATCH_INVALID'; END IF;
  RETURN QUERY
  WITH claimed AS (
    SELECT id FROM public.email_outbox
    WHERE status IN ('pending','failed') AND next_attempt_at <= now() AND attempts < 8
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT _batch_size
  )
  UPDATE public.email_outbox o
  SET status = 'sending', attempts = o.attempts + 1, updated_at = now()
  FROM claimed
  WHERE o.id = claimed.id
  RETURNING o.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_account_deletion()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _email text := lower(coalesce(auth.email(),''));
  _request_id uuid;
BEGIN
  IF _user_id IS NULL OR _email = '' THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account-delete:' || _user_id::text, 20260717));

  PERFORM 1 FROM public.organizations WHERE owner_id = _user_id LIMIT 1 FOR UPDATE;
  IF FOUND THEN RAISE EXCEPTION 'ACCOUNT_DELETION_BLOCKED_OWNER'; END IF;

  SELECT id INTO _request_id
  FROM public.account_deletion_requests
  WHERE subject_user_id = _user_id AND status = 'pending'
  FOR UPDATE;

  IF _request_id IS NULL THEN
    INSERT INTO public.account_deletion_requests(subject_user_id,email,status)
    VALUES (_user_id,_email,'pending')
    RETURNING id INTO _request_id;

    INSERT INTO public.security_events(user_id,organization_id,event_type,outcome,metadata)
    VALUES (_user_id,NULL,'account.deletion_requested','success',jsonb_build_object('request_id',_request_id));
  END IF;

  RETURN _request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_account_deletion(
  _request_id uuid,
  _success boolean,
  _error_code text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _request public.account_deletion_requests%ROWTYPE;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' THEN RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'; END IF;

  SELECT * INTO _request
  FROM public.account_deletion_requests
  WHERE id = _request_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_DELETION_REQUEST_INVALID'; END IF;

  IF _success THEN
    IF _request.status = 'deleted' THEN RETURN true; END IF;
    IF _request.email IS NULL OR _request.email = '' THEN RAISE EXCEPTION 'ACCOUNT_DELETION_EMAIL_MISSING'; END IF;

    INSERT INTO public.email_outbox(organization_id,template,recipient,dedupe_key,payload)
    VALUES (NULL,'account_deleted',_request.email,'account_deleted:' || _request.id::text,jsonb_build_object('request_id',_request.id))
    ON CONFLICT (dedupe_key) DO NOTHING;

    INSERT INTO public.security_events(user_id,organization_id,event_type,outcome,dedupe_key,metadata)
    VALUES (NULL,NULL,'account.deleted','success','account_deleted:' || _request.id::text,jsonb_build_object(
      'request_id',_request.id,
      'deleted_user_id',_request.subject_user_id
    )) ON CONFLICT (dedupe_key) DO NOTHING;

    UPDATE public.account_deletion_requests
    SET status = 'deleted', completed_at = now(), last_error = NULL, email = NULL,
        metadata = metadata || jsonb_build_object('email_queued',true), updated_at = now()
    WHERE id = _request.id;
    RETURN true;
  END IF;

  UPDATE public.account_deletion_requests
  SET status = 'failed', completed_at = now(), last_error = left(coalesce(_error_code,'ACCOUNT_DELETION_FAILED'),200), updated_at = now()
  WHERE id = _request.id;

  INSERT INTO public.security_events(user_id,organization_id,event_type,outcome,metadata)
  VALUES (NULL,NULL,'account.deletion_failed','failure',jsonb_build_object(
    'request_id',_request.id,
    'subject_user_id',_request.subject_user_id,
    'error_code',left(coalesce(_error_code,'ACCOUNT_DELETION_FAILED'),200)
  ));
  RETURN false;
END;
$$;

-- ---------------------------------------------------------------------------
-- Ownership and role management
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transfer_organization_ownership(_organization_id uuid, _new_owner_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE _user_id uuid := auth.uid();
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF _new_owner_user_id = _user_id THEN RAISE EXCEPTION 'OWNERSHIP_TRANSFER_INVALID'; END IF;
  PERFORM 1 FROM public.organizations WHERE id = _organization_id AND owner_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OWNER_REQUIRED'; END IF;
  PERFORM 1 FROM public.organization_members WHERE organization_id = _organization_id AND user_id = _new_owner_user_id AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NEW_OWNER_MUST_BE_ACTIVE_MEMBER'; END IF;
  PERFORM set_config('dealflowiq.ownership_transfer','on',true);
  UPDATE public.organizations SET owner_id = _new_owner_user_id, updated_at = now() WHERE id = _organization_id;
  UPDATE public.organization_members SET role = 'admin', updated_at = now() WHERE organization_id = _organization_id AND user_id = _user_id;
  UPDATE public.organization_members SET role = 'owner', status = 'active', updated_at = now() WHERE organization_id = _organization_id AND user_id = _new_owner_user_id;
  INSERT INTO public.audit_logs(organization_id,actor_id,event_type,entity_type,entity_id,metadata)
  VALUES (_organization_id,_user_id,'ownership.transferred','organization',_organization_id,jsonb_build_object('new_owner_user_id',_new_owner_user_id));
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_last_owner()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  _canonical_owner uuid;
BEGIN
  IF coalesce(current_setting('dealflowiq.ownership_transfer',true),'off') = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  SELECT owner_id INTO _canonical_owner
  FROM public.organizations
  WHERE id = OLD.organization_id
  FOR UPDATE;

  IF OLD.user_id = _canonical_owner THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'LAST_OWNER_REQUIRED';
    ELSIF NEW.user_id <> OLD.user_id OR NEW.role::text <> 'owner' OR NEW.status <> 'active' THEN
      RAISE EXCEPTION 'LAST_OWNER_REQUIRED';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_organization_owner_id()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.owner_id IS DISTINCT FROM NEW.owner_id
     AND coalesce(current_setting('dealflowiq.ownership_transfer',true),'off') <> 'on' THEN
    RAISE EXCEPTION 'OWNERSHIP_TRANSFER_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_canonical_owner_membership()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  _organization_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'organizations' THEN
    _organization_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    _organization_id := OLD.organization_id;
  ELSE
    _organization_id := NEW.organization_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = _organization_id) THEN RETURN NULL; END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations o
    JOIN public.organization_members om
      ON om.organization_id = o.id
     AND om.user_id = o.owner_id
     AND om.role = 'owner'
     AND om.status = 'active'
    WHERE o.id = _organization_id
  ) THEN
    RAISE EXCEPTION 'CANONICAL_OWNER_MEMBERSHIP_REQUIRED';
  END IF;
  RETURN NULL;
END;
$$;

UPDATE public.organization_members om
SET role = 'admin', updated_at = now()
FROM public.organizations o
WHERE om.organization_id = o.id
  AND om.role = 'owner'
  AND om.user_id <> o.owner_id;

INSERT INTO public.organization_members(organization_id,user_id,role,status)
SELECT id,owner_id,'owner','active' FROM public.organizations
ON CONFLICT (organization_id,user_id) DO UPDATE SET role = 'owner', status = 'active', updated_at = now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_organization_members_one_active_owner
ON public.organization_members(organization_id)
WHERE role = 'owner' AND status = 'active';

DROP TRIGGER IF EXISTS protect_last_owner_trigger ON public.organization_members;
CREATE TRIGGER protect_last_owner_trigger
BEFORE UPDATE OR DELETE ON public.organization_members
FOR EACH ROW EXECUTE FUNCTION public.protect_last_owner();

DROP TRIGGER IF EXISTS protect_organization_owner_id_trigger ON public.organizations;
CREATE TRIGGER protect_organization_owner_id_trigger
BEFORE UPDATE OF owner_id ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.protect_organization_owner_id();

DROP TRIGGER IF EXISTS validate_canonical_owner_on_organization ON public.organizations;
CREATE CONSTRAINT TRIGGER validate_canonical_owner_on_organization
AFTER INSERT OR UPDATE OF owner_id ON public.organizations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_canonical_owner_membership();

DROP TRIGGER IF EXISTS validate_canonical_owner_on_membership ON public.organization_members;
CREATE CONSTRAINT TRIGGER validate_canonical_owner_on_membership
AFTER INSERT OR UPDATE OR DELETE ON public.organization_members
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_canonical_owner_membership();

-- Global retention cleanup is service-role/platform-admin only.
CREATE OR REPLACE FUNCTION public.cleanup_expired_market_source_data()
RETURNS TABLE(cleaned_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE affected integer := 0;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' AND NOT public.current_user_is_platform_admin() THEN
    RAISE EXCEPTION 'PLATFORM_ADMIN_REQUIRED';
  END IF;
  UPDATE public.market_listings
  SET description = NULL,
      image_urls = '[]'::jsonb,
      primary_image_url = NULL,
      raw_payload = jsonb_build_object('provider_data_expired_at', now(), 'retained', 'source_url, DealFlowIQ analysis, scores, notes, matches and audit trail'),
      provider_data_expired_at = now(),
      updated_at = now()
  WHERE provider_data_expires_at IS NOT NULL
    AND provider_data_expires_at <= now()
    AND provider_data_expired_at IS NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN QUERY SELECT affected;
END;
$$;

-- ---------------------------------------------------------------------------
-- RLS and least privilege
-- ---------------------------------------------------------------------------
ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_acceptance_cutovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_invite_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS legal_acceptances_select_own ON public.legal_acceptances;
CREATE POLICY legal_acceptances_select_own ON public.legal_acceptances FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS invite_acceptances_select_own_or_admin ON public.community_invite_acceptances;
CREATE POLICY invite_acceptances_select_own_or_admin ON public.community_invite_acceptances FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.current_user_has_org_role(organization_id,ARRAY['owner','admin']) OR public.current_user_is_platform_admin());
DROP POLICY IF EXISTS email_outbox_select_admin ON public.email_outbox;
CREATE POLICY email_outbox_select_admin ON public.email_outbox FOR SELECT TO authenticated
USING (public.current_user_has_org_role(organization_id,ARRAY['owner','admin']) OR public.current_user_is_platform_admin());
DROP POLICY IF EXISTS security_events_select_own_or_admin ON public.security_events;
CREATE POLICY security_events_select_own_or_admin ON public.security_events FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS account_deletion_requests_select_own_or_admin ON public.account_deletion_requests;
CREATE POLICY account_deletion_requests_select_own_or_admin ON public.account_deletion_requests FOR SELECT TO authenticated
USING (subject_user_id = auth.uid() OR public.current_user_is_platform_admin());

REVOKE ALL ON public.auth_rate_limits FROM anon, authenticated;
REVOKE ALL ON public.legal_acceptance_cutovers FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.account_deletion_requests FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.organization_members FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.community_team_members FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.community_invites FROM authenticated;
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name, updated_at) ON public.profiles TO authenticated;
REVOKE UPDATE ON public.organizations FROM authenticated;
GRANT UPDATE (name, slug, organization_type, account_type, primary_market, primary_strategy, updated_at) ON public.organizations TO authenticated;

-- Start from deny-by-default for every SECURITY DEFINER function. Safe RLS
-- helpers and controlled RPC entry points are granted explicitly below.
DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated', fn.nspname, fn.proname, fn.args);
  END LOOP;
END $$;

-- Safe membership helpers are needed by RLS evaluation. They expose only a
-- boolean for the current JWT and do not mutate data.
GRANT EXECUTE ON FUNCTION public.current_user_is_org_member(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_has_org_role(uuid,text[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_is_platform_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_is_org_writer(uuid) TO anon, authenticated;

-- High-risk historical signatures are no longer callable by clients.
REVOKE ALL ON FUNCTION public.ensure_organization_subscription(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_admin_access_invite(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_organization_subscription_internal(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_admin_access_invite_internal(uuid) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.current_user_has_required_legal_acceptance() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_community_invite(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_community_invite(text,text,uuid,text,integer,integer,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_community_invite(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_community_invite(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bootstrap_current_user(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_default_organization() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_active_organization(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restore_organization_subscription(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_user_onboarding(text,text,text,text,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.skip_user_onboarding(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_user_workspace_settings(text,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transfer_organization_ownership(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_auth_rate_limit(text,text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_email_outbox(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_password_change_event(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prepare_account_deletion() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_account_deletion(uuid,boolean,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_expired_market_source_data() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.validate_community_invite(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_auth_rate_limit(text,text,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_community_invite(text,text,uuid,text,integer,integer,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_community_invite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_community_invite(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_current_user(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_default_organization() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_active_organization(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_organization_subscription(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_user_onboarding(text,text,text,text,text,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.skip_user_onboarding(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_user_workspace_settings(text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_organization_ownership(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_email_outbox(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_password_change_event(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.prepare_account_deletion() TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_account_deletion(uuid,boolean,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_market_source_data() TO authenticated, service_role;

-- Every public SECURITY DEFINER function gets a deterministic trusted path.
DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('ALTER FUNCTION %I.%I(%s) SET search_path TO pg_catalog, public', fn.nspname, fn.proname, fn.args);
  END LOOP;
END $$;

COMMENT ON FUNCTION public.bootstrap_current_user(text) IS 'Explicit, advisory-locked, idempotent auth bootstrap. Never call from workspace reads.';
COMMENT ON FUNCTION public.revoke_community_invite(uuid) IS 'Controlled owner/admin invite revocation with row locking and audit logging.';
COMMENT ON FUNCTION public.accept_community_invite(text) IS 'Atomic and idempotent invite acceptance with row locking and no implicit role downgrade.';
COMMENT ON FUNCTION public.complete_user_onboarding(text,text,text,text,text,integer) IS 'Atomically persists profile, workspace preferences and onboarding completion.';
