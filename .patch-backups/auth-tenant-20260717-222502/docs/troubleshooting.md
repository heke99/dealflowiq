# Troubleshooting

## Auth / onboarding

**"Your Supabase environment variables are missing"** — set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local` and restart the dev server.

**User lands on the dashboard without a workspace** — the `create_default_organization` RPC failed on first load. The dashboard shows a recovery banner with a retry action; check Supabase logs for the RPC error. Common cause: migrations not fully applied (the function is redefined in `026_trial_access_member_overrides.sql`).

**Signup succeeded but no trial subscription** — verify the `(uuid, text)` overload of `ensure_organization_subscription` exists and that `billing_plans` contains the seeded `free` / `premium` / `community_owner` plans from migration `033`.

**Invite code rejected** — invites expire (`expires_at`) and have `max_uses`. Check `community_invites.status`; revoked/expired invites must be re-issued from `/community`.

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
