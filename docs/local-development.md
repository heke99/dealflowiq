# Local development

## Prerequisites

- Node.js 20+
- npm 10+
- A Supabase project (hosted or `supabase start` local stack)
- Optional: Stripe test account, HUD USER API token, Resend account

## Setup

```bash
npm ci
cp .env.example .env.local
# fill in Supabase URL / keys at minimum
```

### Database

Migration filenames use unique 14-digit versions. Validate them and rebuild the local stack:

```bash
npm run db:migrations:check
./scripts/sync-supabase.sh --local-reset
```

For an existing linked Supabase project, use the backup + history-repair procedure in [database.md](./database.md#migration-reconciliation). Do not run a raw `db push` immediately after upgrading from the old duplicate-number history.

### First platform admin (bootstrap)

Platform admins are stored in `public.platform_admins`. After creating your own account through `/signup`, run once in the Supabase SQL editor:

```sql
insert into public.platform_admins (user_id, note)
select id, 'bootstrap admin' from auth.users where email = 'you@example.com'
on conflict (user_id) do nothing;
```

There is intentionally no public bootstrap endpoint.

### Stripe (optional locally)

1. Set `STRIPE_SECRET_KEY` (test mode) and create plans at `/admin/plans` — the app creates Stripe products/prices for you.
2. Forward webhooks: `stripe listen --forward-to localhost:3000/api/stripe/webhook` and put the printed signing secret in `STRIPE_WEBHOOK_SECRET`.

### Cron worker (optional locally)

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/market-imports
```

## Commands

```bash
npm run dev         # dev server
npm run build       # production build (must always pass)
npm run lint        # eslint
npm run typecheck   # tsc --noEmit
npm run test        # vitest run
npm run verify      # full release gate
npm run test:watch  # vitest watch mode
```

## Troubleshooting

See [troubleshooting.md](./troubleshooting.md).
