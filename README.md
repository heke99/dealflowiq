# DealFlowIQ

DealFlowIQ is a SaaS platform for real-estate investors: import and score listings from the market, run underwriting and rent intelligence (HUD FMR, market comps), manage deals and files, match opportunities to buy boxes and buyers, and collaborate through communities and in-app messaging — with organization workspaces, roles, plans and Stripe billing built in.

> **Disclaimer:** DealFlowIQ provides analysis tools only. It is not legal, tax, investment, lending or financial advice. Imported listing data may be incomplete or stale, and scoring is an estimate, not a guarantee. Verify all data independently.

## Tech stack

- **Next.js 16** (App Router, React 19, Turbopack, `proxy.ts` request handling)
- **Supabase** — Postgres + RLS, Auth, Storage (private `deal-files` bucket)
- **Stripe** — checkout, billing portal, webhooks, product/price sync
- **Tailwind CSS 4**, TypeScript 5, Vitest

## Feature map

| Area | Routes |
|---|---|
| Auth & onboarding | `/signup`, `/login`, `/forgot-password`, `/reset-password`, `/onboarding` |
| Deals & underwriting | `/deals`, `/deals/[id]/analyzer`, `/deals/[id]/rent-intelligence`, `/calculators` |
| Market & imports | `/market`, `/imports`, `/opportunities`, `/saved-deals` |
| Matching | `/buy-boxes`, `/buyers` |
| Collaboration | `/community`, `/messages`, `/notifications` |
| Billing | `/plans`, `/settings/billing` |
| Platform admin | `/admin`, `/admin/users`, `/admin/plans`, `/admin/access` |

## Local setup

```bash
npm ci
cp .env.example .env.local   # fill in Supabase keys at minimum
npm run dev
```

Full guide: [docs/local-development.md](docs/local-development.md) · Environment variables: [docs/env-vars.md](docs/env-vars.md)

### Supabase setup

Apply migrations in `supabase/migrations/` in filename order (`supabase db push`). Migrations are forward-only; new changes go in new files starting at `034_`.

### Admin bootstrap

Platform admins live in `public.platform_admins`. After signing up, insert your user id manually (SQL snippet in [docs/local-development.md](docs/local-development.md#first-platform-admin-bootstrap)). There is no public bootstrap endpoint by design.

### Stripe setup

Set `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`, create plans in `/admin/plans` (the app syncs products/prices to Stripe), and point a webhook at `/api/stripe/webhook`. Details: [docs/deployment.md](docs/deployment.md#3-stripe).

### Cron setup

Scheduled market imports run via `GET /api/cron/market-imports` (configured hourly in `vercel.json`). Protect it with `CRON_SECRET` — required in production.

## Commands

```bash
npm run dev         # dev server
npm run build       # production build
npm run lint        # eslint
npm run typecheck   # tsc --noEmit
npm run test        # vitest run
npm run test:watch  # vitest watch
```

## Deployment

Checklist and rollback plan: [docs/deployment.md](docs/deployment.md) · Operational posture: [docs/production-readiness.md](docs/production-readiness.md) · Troubleshooting: [docs/troubleshooting.md](docs/troubleshooting.md)
