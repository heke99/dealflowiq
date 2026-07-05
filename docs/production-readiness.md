# Production readiness

Status tracker for launch. Updated as hardening batches land.

## Build & quality gates

| Gate | Status |
|---|---|
| `npm run build` | Must pass on every commit. |
| `npm run typecheck` | Must pass; do not weaken `tsconfig.json`. |
| `npm run lint` | Errors are fixed, not silenced. Remaining known issues are listed below. |
| `npm run test` | Unit tests for billing access, underwriting, scoring, imports, matching. |

## Dependency audit

`npm audit` status (last reviewed with this doc):

- **js-yaml (moderate)** — fixed via `npm audit fix` (dev-only chain through eslint tooling).
- **postcss < 8.5.10 via next (moderate)** — the advisory's proposed "fix" is downgrading to `next@9.3.3`, which is wrong for this app. Next 16.2.6 bundles its own postcss internally for build-time CSS processing; the XSS vector (unescaped `</style>` in stringified output) does not apply to our usage (no user-controlled CSS is stringified). Track Next.js releases and upgrade when a patched 16.x ships. Do **not** run `npm audit fix --force`.

## Security posture

- Supabase service-role key used only in server code (`lib/supabase/admin.ts`); never imported from client components.
- All tables have RLS enabled; tenancy is organization-scoped with explicit public-visibility carve-outs (public/community listings).
- `/admin/*` is gated server-side by `platform_admins` membership, plus per-action `requirePlatformAdmin()`.
- Stripe webhook verifies signatures (HMAC, 300s tolerance) and is idempotent via `stripe_webhook_events.stripe_event_id` (unique).
- Cron routes require `CRON_SECRET` in production.
- Deal files live in a private bucket, path-scoped per organization, served via 1-hour signed URLs.
- Platform-admin bootstrap is manual SQL only (no public endpoint).

## Data retention

| Data | Policy |
|---|---|
| Provider raw listing data | Expires per provider policy (`provider_data_expires_at`); cleared by `cleanup_expired_market_source_data()` during cron runs and manual cleanup. |
| Stripe webhook events | Retained for audit; safe to prune rows older than 90 days once processed. |
| Import audit events | Used for rate limiting (rolling windows); prune rows older than 90 days. |
| Notifications | Users can delete; stale notifications can be pruned after 90 days. |
| Failed import jobs / queue items | Swept back or terminally failed by the worker; prune terminal rows older than 30 days. |
| User data deletion | Delete the auth user in Supabase; `profiles` and memberships cascade. Organization data is retained unless the org itself is deleted. |

## Backups and restore

- Enable Supabase PITR (Pro plan) or rely on daily backups.
- Restore procedure: restore to a new project → repoint `NEXT_PUBLIC_SUPABASE_URL`/keys → verify auth users + `organization_subscriptions` → re-sync Stripe state from the Stripe dashboard if the restore window crossed billing events.
- Verify restore quarterly by restoring to a scratch project and running the post-deploy checklist.
- Migration rollback: migrations are forward-only; write a compensating migration rather than editing history.

## Known remaining issues

Tracked here so they are explicit rather than silent:

- Multi-organization users: only the first (oldest) active membership is used as the current workspace; there is no org switcher yet.
- `/market-search` redirects to `/imports` (search-based discovery is folded into the import pipeline).
- `deal_units` table exists but per-unit rent entry is not yet exposed in the UI; the engine uses `properties.number_of_units`.
