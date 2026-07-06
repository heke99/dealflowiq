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

## Observability

- All server events use structured single-line JSON logging via `lib/observability/log.ts` (`logInfo`/`logWarn`/`logError`); search Vercel logs by the `event` field (e.g. `cron.market_imports.completed`, `stripe.webhook.signature_failed`).
- `userSafeError()` sanitizes messages shown to users; internal details stay in server logs.
- Optional `ERROR_WEBHOOK_URL` forwards error events to any HTTP collector (Slack, Sentry proxy). Never required for build or runtime.
- Operational trails in the database: `audit_logs` (admin/billing/deal events), `stripe_webhook_events`, `market_import_audit_events`, `market_import_jobs`, `hud_lookup_events`, `conversation_reports`.

## Data retention (automated)

The hourly cron (`/api/cron/market-imports`) runs `runDataRetentionSweep` (`lib/retention.ts`) plus provider cleanup on every authorized run:

| Data | Policy |
|---|---|
| Provider raw listing data | Expires per provider policy (`provider_data_expires_at`); cleared by `cleanup_expired_market_source_data()` each cron run. |
| Stripe webhook events | Processed events pruned after 90 days (failed events kept for retries). |
| Import audit events | Pruned after 90 days (rolling rate-limit windows are ≤30 days). |
| Notifications | Read/archived notifications pruned after 90 days. |
| Failed import jobs | Terminal failures pruned after 30 days; stuck running jobs/queue items swept back every run. |
| Stale import preview items | Deleted after 14 days in non-imported statuses. |
| User data deletion | Delete the auth user in Supabase; `profiles` and memberships cascade. Organization data is retained unless the org itself is deleted. |

## Backups and restore

- Enable Supabase PITR (Pro plan) or rely on daily backups.
- Restore procedure: restore to a new project → repoint `NEXT_PUBLIC_SUPABASE_URL`/keys → verify auth users + `organization_subscriptions` → re-sync Stripe state from the Stripe dashboard if the restore window crossed billing events.
- Verify restore quarterly by restoring to a scratch project and running the post-deploy checklist.
- Migration rollback: migrations are forward-only; write a compensating migration rather than editing history.

## Release checklist

Complete before flipping production traffic:

- [ ] `npm run build`, `npm run lint`, `npm run typecheck`, `npm run test` all pass on the release commit
- [ ] All migrations `001`–`037` applied to the production Supabase project in filename order (validated end-to-end on Postgres 16)
- [ ] `.env` complete per [env-vars.md](./env-vars.md); `CRON_SECRET` set (production cron is disabled without it)
- [ ] Stripe live keys + webhook endpoint configured; a test event shows `processed` in `stripe_webhook_events`
- [ ] First platform admin seeded in `platform_admins`
- [ ] Billing plans created and synced (`/admin/plans` shows `synced` status)
- [ ] Provider policies reviewed at the platform level (`market_provider_policies`) — only providers with documented authorization active
- [ ] Post-deploy smoke: signup → onboarding → dashboard; URL import; deal create + analyzer; checkout (test mode first); `/terms` + `/support` load; cron route returns 401 without secret and 200 with it

## Rollback plan

- **Application**: redeploy the previous Vercel build (instant, stateless). All releases on this branch keep `npm run build` green per commit, so any prior commit is deployable.
- **Database**: migrations are forward-only and additive (new tables/columns/policies/functions). Prefer a fix-forward migration. The only destructive statement in the hardening series is dropping the unused `ensure_organization_subscription(uuid,uuid,integer)` overload (034) — restorable from `025_freemium_admin_community_batch.sql` if ever needed.
- **Stripe**: webhook processing is idempotent; events can be replayed from the Stripe dashboard after recovery. Do not delete `stripe_webhook_events` rows during an incident.
- **Catastrophic data loss**: restore Supabase PITR/daily backup to a new project, repoint env vars, verify auth users and subscriptions, replay recent Stripe events.

## Known remaining issues

Tracked here so they are explicit rather than silent:

- Multi-organization users: only the first (oldest) active membership is used as the current workspace; there is no org switcher yet.
- `/market-search` redirects to `/imports` (search-based discovery is folded into the import pipeline).
- `deal_units` table exists but per-unit rent entry is not yet exposed in the UI; the engine uses `properties.number_of_units`.
