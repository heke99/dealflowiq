\set ON_ERROR_STOP on

CREATE TEMP TABLE security_audit_issues (
  category text NOT NULL,
  object_name text NOT NULL,
  detail text NOT NULL
);

-- Every public SECURITY DEFINER function must resolve built-ins from pg_catalog first.
INSERT INTO security_audit_issues(category, object_name, detail)
SELECT
  'security_definer_search_path',
  format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)),
  coalesce(array_to_string(p.proconfig, ', '), 'missing function configuration')
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS setting
    WHERE replace(setting, ' ', '') = 'search_path=pg_catalog,public'
  );

-- No SECURITY DEFINER function may inherit EXECUTE through PUBLIC. Client-role
-- grants are allowed only for the explicit RLS-helper/RPC allowlist below.
WITH function_grants AS (
  SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS arguments,
         acl.grantee, acl.privilege_type, grantee.rolname
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
  LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
  WHERE n.nspname = 'public' AND p.prosecdef
), allowed_client_functions(role_name, name, arguments) AS (
  VALUES
    ('anon','current_user_is_org_member','uuid'),
    ('authenticated','current_user_is_org_member','uuid'),
    ('anon','current_user_has_org_role','uuid, text[]'),
    ('authenticated','current_user_has_org_role','uuid, text[]'),
    ('anon','current_user_is_platform_admin',''),
    ('authenticated','current_user_is_platform_admin',''),
    ('anon','current_user_is_org_writer','uuid'),
    ('authenticated','current_user_is_org_writer','uuid'),
    ('authenticated','create_community_invite','text, text, uuid, text, integer, integer, boolean'),
    ('authenticated','accept_community_invite','text'),
    ('authenticated','revoke_community_invite','uuid'),
    ('authenticated','bootstrap_current_user','text'),
    ('authenticated','create_default_organization',''),
    ('authenticated','set_active_organization','uuid'),
    ('authenticated','restore_organization_subscription','uuid'),
    ('authenticated','complete_user_onboarding','text, text, text, text, text, integer'),
    ('authenticated','skip_user_onboarding','integer'),
    ('authenticated','update_user_workspace_settings','text, text, text, text, text'),
    ('authenticated','transfer_organization_ownership','uuid, uuid'),
    ('authenticated','prepare_account_deletion',''),
    ('authenticated','cleanup_expired_market_source_data','')
)
INSERT INTO security_audit_issues(category, object_name, detail)
SELECT
  CASE WHEN fg.grantee = 0 THEN 'security_definer_public_execute' ELSE 'unexpected_security_definer_grant' END,
  format('public.%I(%s)', fg.proname, fg.arguments),
  format('EXECUTE granted to %s', CASE WHEN fg.grantee = 0 THEN 'PUBLIC' ELSE fg.rolname END)
FROM function_grants fg
WHERE fg.privilege_type = 'EXECUTE'
  AND (
    fg.grantee = 0
    OR (
      fg.rolname IN ('anon','authenticated')
      AND NOT EXISTS (
        SELECT 1 FROM allowed_client_functions allowed
        WHERE allowed.role_name = fg.rolname
          AND allowed.name = fg.proname
          AND replace(allowed.arguments,' ','') = replace(fg.arguments,' ','')
      )
    )
  );

-- These internal/high-risk functions must never be executable through PUBLIC/anon/authenticated.
WITH protected_functions(name, arguments) AS (
  VALUES
    ('ensure_organization_subscription_internal', 'uuid, text'),
    ('apply_admin_access_invite_internal', 'uuid'),
    ('consume_auth_rate_limit', 'text, text, integer, integer'),
    ('claim_email_outbox', 'integer'),
    ('current_user_has_required_legal_acceptance', ''),
    ('record_password_change_event', 'uuid, uuid'),
    ('finalize_account_deletion', 'uuid, boolean, text')
), resolved AS (
  SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS arguments, p.proacl, p.proowner
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN protected_functions expected
    ON expected.name = p.proname
   AND replace(expected.arguments, ' ', '') = replace(pg_get_function_identity_arguments(p.oid), ' ', '')
  WHERE n.nspname = 'public'
), missing AS (
  SELECT expected.name, expected.arguments
  FROM protected_functions expected
  WHERE NOT EXISTS (
    SELECT 1 FROM resolved r
    WHERE r.proname = expected.name
      AND replace(r.arguments, ' ', '') = replace(expected.arguments, ' ', '')
  )
), missing_insert AS (
  INSERT INTO security_audit_issues(category, object_name, detail)
  SELECT 'missing_high_risk_function', format('public.%I(%s)', name, arguments), 'required protected function is missing'
  FROM missing
  RETURNING 1
), grants AS (
  SELECT r.*, acl.grantee, acl.privilege_type, grantee.rolname
  FROM resolved r
  CROSS JOIN LATERAL aclexplode(coalesce(r.proacl, acldefault('f', r.proowner))) acl
  LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
)
INSERT INTO security_audit_issues(category, object_name, detail)
SELECT
  'high_risk_function_grant',
  format('public.%I(%s)', proname, arguments),
  format('EXECUTE granted to %s', CASE WHEN grantee = 0 THEN 'PUBLIC' ELSE rolname END)
FROM grants
WHERE privilege_type = 'EXECUTE'
  AND (grantee = 0 OR rolname IN ('anon', 'authenticated'));

-- Non-consuming invite preview is server-only.
WITH target AS (
  SELECT p.oid, p.proacl, p.proowner
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'validate_community_invite'
    AND replace(pg_get_function_identity_arguments(p.oid), ' ', '') = 'text'
), grants AS (
  SELECT acl.grantee, acl.privilege_type, grantee.rolname
  FROM target t
  CROSS JOIN LATERAL aclexplode(coalesce(t.proacl, acldefault('f', t.proowner))) acl
  LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
)
INSERT INTO security_audit_issues(category, object_name, detail)
SELECT 'invite_validation_grant', 'public.validate_community_invite(text)',
       format('EXECUTE granted to %s', CASE WHEN grantee = 0 THEN 'PUBLIC' ELSE rolname END)
FROM grants
WHERE privilege_type = 'EXECUTE'
  AND (grantee = 0 OR rolname IN ('anon', 'authenticated'));

-- Client roles must not directly mutate tenant membership/invite state.
WITH sensitive_tables(table_name) AS (
  VALUES ('organization_members'), ('community_team_members'), ('community_invites'), ('community_invite_acceptances'),
    ('auth_rate_limits'), ('legal_acceptances'), ('legal_acceptance_cutovers'), ('email_outbox'),
    ('security_events'), ('account_deletion_requests')
), client_roles(role_name) AS (
  VALUES ('anon'), ('authenticated')
), checks AS (
  SELECT s.table_name, r.role_name, privilege
  FROM sensitive_tables s
  CROSS JOIN client_roles r
  CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE')) AS permissions(privilege)
  WHERE to_regrole(r.role_name) IS NOT NULL
    AND has_table_privilege(r.role_name, format('public.%I', s.table_name), privilege)
)
INSERT INTO security_audit_issues(category, object_name, detail)
SELECT 'sensitive_table_grant', format('public.%I', table_name), format('%s granted to %s', privilege, role_name)
FROM checks;

-- owner_id is only changed by the guarded transfer function.
INSERT INTO security_audit_issues(category, object_name, detail)
SELECT 'owner_column_grant', 'public.organizations.owner_id', 'UPDATE granted to authenticated'
WHERE to_regrole('authenticated') IS NOT NULL
  AND has_column_privilege('authenticated', 'public.organizations', 'owner_id', 'UPDATE');

-- Required ownership guards and FK semantics must exist in the live schema.
INSERT INTO security_audit_issues(category, object_name, detail)
SELECT 'missing_trigger', required.name, 'required ownership/tenant trigger is missing'
FROM (VALUES
  ('protect_last_owner_trigger'),
  ('protect_organization_owner_id_trigger'),
  ('validate_canonical_owner_on_organization'),
  ('validate_canonical_owner_on_membership')
) AS required(name)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_trigger t
  WHERE t.tgname = required.name AND NOT t.tgisinternal
);

INSERT INTO security_audit_issues(category, object_name, detail)
SELECT 'owner_fk_delete_action', 'public.organizations.owner_id',
       format('expected ON DELETE RESTRICT, found action %s', c.confdeltype)
FROM pg_constraint c
WHERE c.conrelid = 'public.organizations'::regclass
  AND c.contype = 'f'
  AND c.conname = 'organizations_owner_id_fkey'
  AND c.confdeltype <> 'r';

INSERT INTO security_audit_issues(category, object_name, detail)
SELECT 'owner_fk_missing', 'public.organizations.owner_id', 'organizations_owner_id_fkey is missing'
WHERE NOT EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conrelid = 'public.organizations'::regclass
    AND conname = 'organizations_owner_id_fkey'
    AND contype = 'f'
);

TABLE security_audit_issues;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM security_audit_issues) THEN
    RAISE EXCEPTION 'Supabase security audit failed. Review the rows printed above.';
  END IF;
END $$;

SELECT 'Supabase security audit passed.' AS result;
