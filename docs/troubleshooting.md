# Troubleshooting

## Auth / onboarding

**"Your Supabase environment variables are missing"** — set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local` and restart the dev server.

**User has no workspace** — normal page reads never create one. The verified auth callback calls `bootstrap_current_user`; the onboarding recovery button can retry it safely. Check the structured server error and confirm `20260717000100_auth_tenant_reconciliation.sql` is applied.

**Signup succeeded but no trial subscription** — `restore_organization_subscription` can be invoked only by an owner or platform admin. Verify plan seeds and the reconciliation migration; do not grant clients access to the internal ensure function.

**Invite code rejected** — open the canonical `/invites/accept?code=...` route. Check the stable result code, `community_invites`, and `community_invite_acceptances`; repeated acceptance by the same user is intentionally idempotent.

## Billing

**Checkout button errors with "Stripe is not configured"** — set `STRIPE_SECRET_KEY`.

**Webhook returns 400** — signature verification failed. Confirm `STRIPE_WEBHOOK_SECRET` matches the endpoint's signing secret and the raw request body is not modified by a proxy.

**Subscription not updating after payment** — inspect `stripe_webhook_events` for rows with `status='failed'` and read `error_message`. Events can be retried from Stripe's dashboard; processing is idempotent.

**Plan changes not reflected in Stripe** — check `billing_plans.stripe_sync_status` and `stripe_last_error` at `/admin/plans`, then use "Sync Stripe now".

## Imports

**Import fails immediately with a provider policy message** — the provider is disabled or over its hourly cap in `market_provider_policies`. Platform admins can adjust policies; imports blocked by policy fall back to URL-only review listings where allowed.

**Scheduled imports never run** — confirm the Vercel cron entry in `vercel.json`, and that `CRON_SECRET` is set in production. Call the route manually with the bearer secret to test.

**Queue items stuck in `running`** — the worker sweeps stale running items back to `queued` at the start of each run (older than 15 minutes). Trigger a run manually if needed.

## HUD / rent intelligence

**"HUD API token missing"** — set `HUDUSER_API_TOKEN`.

**HUD lookup finds no data for a ZIP** — not all ZIPs resolve via the USPS crosswalk; set `HUDUSER_ALLOW_DIRECT_ZIP_FALLBACK=true` to allow direct ZIP queries, or enter rent manually.

## Build / tooling

**`npm run build` fails on types** — run `npm run typecheck` for the full error list. Never disable type checking in `next.config.ts`.

**`npm audit` reports a Next.js/postcss advisory** — see [production-readiness.md](./production-readiness.md#dependency-audit) for the documented status.
