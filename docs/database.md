# Database reference

Schema migrations use unique 14-digit timestamps and run in filename order. `scripts/check-migrations.mjs` rejects duplicate or malformed versions. The old-to-new filename mapping is retained in `supabase/migration-version-map.csv`; never rename an applied migration without the documented history-repair procedure.

The canonical reconciliation migration is `20260717000100_auth_tenant_reconciliation.sql`.

## Canonical auth and tenant functions

| Function | Client access | Purpose |
|---|---|---|
| `bootstrap_current_user(text)` | authenticated | Explicit, advisory-locked, idempotent profile/workspace bootstrap. |
| `validate_community_invite(text)` | service role via server route | Non-consuming invite status and workspace preview; never exposed directly to browsers. |
| `accept_community_invite(text)` | authenticated | Atomic, row-locked, idempotent invite acceptance. |
| `create_community_invite(...)` | authenticated | Tenant/role/team/rate validated invite creation plus audit/outbox. |
| `set_active_organization(uuid)` | authenticated | Verifies membership and switches tenant context. |
| `complete_user_onboarding(...)` | authenticated | Atomically saves onboarding and audit data. |
| `skip_user_onboarding(integer)` | authenticated | Explicitly records onboarding skip. |
| `update_user_workspace_settings(...)` | authenticated | Validated profile/workspace edits. |
| `restore_organization_subscription(uuid)` | owner/platform admin | Creates a missing subscription only; never overwrites a live one. |
| `transfer_organization_ownership(uuid,uuid)` | current owner | Atomic ownership transfer. |
| `ensure_organization_subscription_internal(...)` | internal only | Bootstrap/recovery implementation. |
| `apply_admin_access_invite_internal(uuid)` | internal only | Applies a locked invite to its explicit target or new bootstrap org. |

`create_default_organization()` remains only as a compatibility wrapper. Application reads must not call it.

## Tenant isolation

- `profiles.active_organization_id` selects the current tenant.
- Every active workspace must be backed by `organization_members(status='active')`.
- Community invites and team memberships use composite `(organization_id,team_id)` foreign keys.
- Direct organization-member INSERT/UPDATE/DELETE is revoked from authenticated clients; role changes must use controlled functions.
- Existing roles are compared using explicit organization/team role ranks and are not implicitly downgraded.

## Ownership

`organizations.owner_id` references `auth.users` with `ON DELETE RESTRICT`. Auth-account deletion must first transfer ownership or intentionally close the organization. The final active owner cannot be removed, disabled or downgraded. A trigger also rejects every direct `owner_id` update unless the controlled transfer function has opened the transaction-local transfer guard.

## Billing state

Application states are `trialing`, `active`, `past_due`, `canceled`, `expired`, `comped`, `manually_granted`, `incomplete`, and `unpaid` as permitted by the final constraints. Member acceptance never invokes billing. Initial access is attached to organization creation, while Stripe/admin events own subsequent changes.

## Migration reconciliation

For a new local database:

```bash
./scripts/sync-supabase.sh --local-reset
```

For a linked database that already contains the old 001–037 schema, back up and repair migration-history records before pushing the reconciliation migration:

```bash
CONFIRM_MIGRATION_HISTORY_REWRITE=YES ./scripts/sync-supabase.sh --existing-linked-project
```

Do not run the existing-project mode against a partially migrated database. Inspect the generated backup and `supabase migration list` first.
