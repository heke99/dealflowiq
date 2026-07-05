# Database reference

Schema is defined by forward-only migrations in `supabase/migrations/`, applied in **filename order**. Several prefixes are duplicated (`017`, `019`, `025`, `026`) — this is historical; do not renumber. New migrations continue from `035_`.

## Multi-defined functions — final state

Several functions were redefined across migrations. The authoritative final versions are:

| Function | Final version | Behavior |
|---|---|---|
| `handle_new_user()` | `017_community_invites_signup_codes` | Auth trigger. Copies signup metadata (email, full name, account type, organization name, `pending_invite_code`) into `profiles`; marks onboarding complete when account type or invite metadata is present. |
| `create_default_organization()` | `026_trial_access_member_overrides` | Workspace bootstrap RPC called on login/workspace load. Ensures profile → accepts pending community invite → reuses existing org or creates org + owner membership → `ensure_organization_subscription` → `apply_admin_access_invite`. Note: the intermediate `017_community` version dropped the subscription/admin-invite calls; `026` restored them. |
| `ensure_organization_subscription(uuid, text)` | `033_batch_stripe_billing_and_parser_intelligence` | Creates a 7-day launch trial on the account-type default plan for new orgs (skipped for platform admins, who get `manually_granted`). Writes `subscription.created` to `audit_logs`. The stale `(uuid, uuid, integer)` overload from `025_freemium` is **dropped in `034`**. |
| `default_plan_for_account_type(text)` | `033` | `community_guru_owner`/`team_company` → `community_owner` plan; every other account type → `premium`; fallback → `free`. |
| `apply_admin_access_invite(uuid, uuid, text)` | `026_trial_access_member_overrides` | Applies an active `admin_access_invites` row matched **by email**. `trial_days` defaults to 0, which grants a `manually_granted` subscription rather than a trial. |
| `cleanup_expired_market_source_data()` | `019_batch_12i2` | Returns `TABLE(cleaned_count integer)`. Clears description/images/raw payload for listings with `provider_data_expires_at <= now()` and stamps `provider_data_expired_at`. |

## RLS model (after `034_production_hardening`)

- Every `public.*` table has RLS enabled.
- **Reads**: org members (active `organization_members` row) read their org's rows; platform admins read everything; explicitly `public`/`community` listings, deals, posts and contact settings are readable across orgs by any authenticated user.
- **Writes**: `current_user_is_org_writer(org_id)` — active member with any role **except `viewer`** — is required for inserts/updates on org content tables (deals, properties, deal units/files, market listings, notes, rent comps, buyers, matches, interactions, buy boxes). Deletes generally require owner/admin.
- **audit_logs**: API inserts require the caller to be an active org member writing with `actor_id = auth.uid()`. SECURITY DEFINER functions and the service role bypass RLS for system events.
- **hud_fmr_cache**: global read for authenticated users; writes restricted to platform admins / service role (the app writes through the admin client).
- **stripe_webhook_events**: service-role writes only; platform admins can read.
- **Service role**: used only server-side (`lib/supabase/admin.ts`) for the Stripe webhook, deal file storage, HUD cache writes and the import worker.

## Subscription statuses

Valid values (CHECK constraint, migration 033): `trialing`, `active`, `past_due`, `canceled`, `expired`, `comped`, `manually_granted`, `incomplete`, `unpaid`. Application code must not invent other statuses (a legacy `paid` reference was removed in the hardening pass).

## Bootstrap

First platform admin is seeded manually:

```sql
insert into public.platform_admins (user_id, note)
select id, 'bootstrap admin' from auth.users where email = 'you@example.com'
on conflict (user_id) do nothing;
```
