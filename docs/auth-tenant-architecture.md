# Auth, onboarding and tenant architecture

## Invariants

1. `getCurrentWorkspace()` is read-only. It never creates a profile, organization, membership, invite acceptance or subscription.
2. `bootstrap_current_user(invite_code)` is the only normal bootstrap entry point. It is explicit, transaction-scoped, protected by a per-user advisory lock and idempotent.
3. New profiles always start with `onboarding_completed = false`.
4. Invite acceptance is row-locked and idempotent through `community_invite_acceptances UNIQUE(invite_id,user_id)`.
5. Existing organization and team roles are never implicitly downgraded.
6. `profiles.active_organization_id` determines tenant context and must reference an active membership.
7. Billing is created only as part of organization bootstrap, an owner/platform-admin recovery call, Stripe webhook logic or an explicit admin grant.
8. Organization ownership changes only through `transfer_organization_ownership`; deleting an auth user cannot cascade-delete the organization.
9. Raw Postgres/Supabase messages are server logs only. URLs contain stable error codes.
10. All `SECURITY DEFINER` functions use `search_path = pg_catalog, public`, and high-risk internal functions have no anon/authenticated execute grant.

## Signup

- Server validates normalized email, full name, account type, workspace name, invite format, legal acceptance, CAPTCHA and rate limit.
- Passwords require 12 characters with uppercase, lowercase and a number.
- The auth trigger copies only harmless, normalized metadata. It never trusts metadata for roles, plans, ownership or membership.
- Terms and privacy document versions are written to `legal_acceptances`.
- Email confirmation returns through `/auth/callback`, which exchanges the code and invokes explicit bootstrap.

## Invites

Canonical link: `/invites/accept?code=...`.

- Logged-out users choose login or signup while the exact invite route is preserved in `next`.
- Logged-in users accept directly.
- Validation does not consume the invite.
- Acceptance locks the invite row, verifies email/expiry/tenant-team integrity, writes membership(s), writes one acceptance record, increments usage once and activates the invited workspace.
- Failures roll back the entire transaction and redirect to `/invites/result` with a stable status code.

## Active workspace

`profiles.active_organization_id` is selected only if the user has an active membership. Read logic falls back to the oldest valid active membership without writing. `set_active_organization` validates membership, updates the preference and writes an audit event.

## Onboarding

`complete_user_onboarding` atomically updates profile, account type, organization preferences, completion timestamps and audit log. `skip_user_onboarding` is separate and records a skip timestamp. Workspace bootstrap never marks onboarding complete.

## Ownership

`organizations.owner_id` uses `ON DELETE RESTRICT`. Direct authenticated updates of `owner_id` and direct membership DML are revoked. Ownership transfer locks the organization and both memberships, promotes the new owner, demotes the old owner to admin and records the event. A trigger prevents removing or disabling the final active owner, and a separate trigger blocks direct `owner_id` changes outside the transaction-local transfer guard.

## Recovery and security

- Password reset requires a short-lived, HTTP-only recovery marker created only after a verified recovery callback.
- Auth attempts use database-backed rate limits and optional Cloudflare Turnstile.
- Security-relevant events are written to `security_events` with hashed request metadata.
- External invite delivery has an `email_outbox` record with attempts/status for retry workers.


## Account deletion

Account deletion requires password reauthentication. It is blocked while the user is canonical owner of any organization; ownership must be transferred or the organization intentionally closed first. Successful deletion removes the auth principal only after ownership checks, records a security event, and queues a confirmation email. Organization data is never cascade-deleted by deleting a login.

## Request routing

Protected application routes check `profiles.onboarding_completed` in the session middleware. Users with incomplete onboarding are redirected to `/onboarding`; invite result/accept routes remain available so an invite result is not hidden. Missing or unreadable profiles enter the explicit repair flow rather than a partially initialized dashboard.
