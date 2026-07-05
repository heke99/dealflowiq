# Environment variables

All variables read by the app via `process.env`. Copy `.env.example` to `.env.local` for local development.

## Required

| Variable | Scope | Used by | Description |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | `lib/supabase/*` | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | `lib/supabase/client.ts`, `server.ts`, `middleware.ts` | Supabase anon key (RLS enforced). |
| `SUPABASE_SERVICE_ROLE_KEY` | **server-only** | `lib/supabase/admin.ts` | Service-role key. Used by the Stripe webhook, deal file uploads and the import worker. Never expose to the browser. |

If the Supabase variables are missing, the auth proxy passes requests through without session handling and server clients throw a descriptive error.

## Stripe (required for paid plans)

| Variable | Scope | Used by | Description |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | server-only | `lib/billing/stripe.ts` | Secret API key. `sk_test_...` keys put the integration in test mode. Without it, billing runs in `not_configured` mode: plans can be saved locally, checkout is unavailable. |
| `STRIPE_WEBHOOK_SECRET` | server-only | `lib/billing/stripe.ts` | Signing secret for `/api/stripe/webhook`. Signature verification fails closed when unset. |

## App URLs

| Variable | Scope | Used by | Description |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | public | `lib/billing/stripe.ts`, `lib/auth/actions.ts`, `app/community/actions.ts` | Canonical base URL used in Stripe success/cancel URLs, auth email links and invite links. |
| `NEXT_PUBLIC_SITE_URL` | public | `lib/auth/actions.ts` | Optional override for auth email redirect base. Falls back to `NEXT_PUBLIC_APP_URL`, then `VERCEL_URL`. |
| `VERCEL_URL` | server | (fallback) | Injected automatically by Vercel. Do not set manually. |

## Cron

| Variable | Scope | Used by | Description |
|---|---|---|---|
| `CRON_SECRET` | server-only | `app/api/cron/*` | Bearer secret for the scheduled import worker. **Required in production** — the route rejects unauthenticated calls when `NODE_ENV=production` and the secret is unset. |

## Resend (optional)

| Variable | Description |
|---|---|
| `RESEND_API_KEY` | Enables community invite emails via Resend. When unset, invites are created with `delivery_status='skipped'` and must be shared manually. |
| `COMMUNITY_INVITE_FROM_EMAIL` | From address for invite emails. Falls back to `RESEND_FROM_EMAIL`, then a default. |
| `RESEND_FROM_EMAIL` | Generic from address fallback. |

## HUD FMR integration (optional)

| Variable | Description |
|---|---|
| `HUDUSER_API_TOKEN` | HUD USER API token for Fair Market Rent lookups. `HUD_USER_API_TOKEN` is accepted as a legacy alias. Without it HUD lookups fail with a clear error; the rest of the app works. |
| `HUDUSER_DEFAULT_YEAR` | `auto` (default) or explicit year. |
| `HUDUSER_FORCE_YEAR` | Force a specific FMR year. |
| `HUDUSER_FMR_API_BASE_URL` / `HUDUSER_USPS_API_BASE_URL` | Override HUD API base URLs. |
| `HUDUSER_FMR_LOOKUP_URL_TEMPLATE` | Advanced: custom lookup URL template. |
| `HUDUSER_ALLOW_DIRECT_ZIP_FALLBACK` | `true` to allow direct ZIP fallback when crosswalk resolution fails. |

## Zillow (optional)

| Variable | Description |
|---|---|
| `ZILLOW_USER_AGENT` | Custom user agent for the rent-comp importer. |

## Observability (optional)

| Variable | Description |
|---|---|
| `SENTRY_DSN` | When present, server errors reported by `lib/observability/log.ts` include a hint to forward to Sentry; the app never requires Sentry to build or run. |
