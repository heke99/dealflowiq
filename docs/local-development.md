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

Apply the migrations in `supabase/migrations/` in filename order. With the Supabase CLI:

```bash
supabase link --project-ref <your-ref>
supabase db push
```

Note: several migration numbers are duplicated (`017`, `019`, `025`, `026`). They apply safely in **filename order** (the order `ls` shows). Do not renumber existing files; new migrations continue from `034_`.

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
npm run test:watch  # vitest watch mode
```

## Troubleshooting

See [troubleshooting.md](./troubleshooting.md).
