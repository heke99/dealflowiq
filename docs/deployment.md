# Deployment

The app is designed for Vercel + hosted Supabase + Stripe, but any Node 20 host works.

## 1. Supabase

1. Create a project and apply all migrations in `supabase/migrations/` in filename order (`supabase db push`).
2. Confirm storage bucket `deal-files` exists (created by migration `031`).
3. Note the project URL, anon key and service-role key.

## 2. Vercel project

Set environment variables (see [env-vars.md](./env-vars.md)):

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL` (your production domain)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `CRON_SECRET` (long random string — required in production)
- Optional: `RESEND_API_KEY`, `HUDUSER_API_TOKEN`, etc.

`vercel.json` already configures the region and the hourly cron for `/api/cron/market-imports`. Vercel Cron automatically sends `Authorization: Bearer $CRON_SECRET` when the env var is set.

## 3. Stripe

1. Live keys in Vercel env.
2. Create a webhook endpoint pointing to `https://<domain>/api/stripe/webhook` with events:
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`.
3. Put the endpoint's signing secret in `STRIPE_WEBHOOK_SECRET`.
4. From `/admin/plans`, save each paid plan and use "Sync Stripe now" — the app creates products/prices and records sync status.

## 4. Admin bootstrap

After your own signup, insert your user into `platform_admins` (see [local-development.md](./local-development.md#first-platform-admin-bootstrap)).

## 5. Post-deploy checklist

- [ ] `/` , `/plans`, `/terms`, `/privacy` load
- [ ] Signup → email confirm → dashboard works
- [ ] `/admin` reachable only for platform admins
- [ ] Checkout completes and webhook marks the subscription `active` (`stripe_webhook_events` row `processed`)
- [ ] `GET /api/cron/market-imports` with the bearer secret returns `{ ok: true }`
- [ ] Cron route **without** secret returns 401
- [ ] Deal file upload works and files are served via signed URLs only

## Rollback

- App: redeploy the previous Vercel build (instant).
- Database: migrations are additive; prefer a fix-forward migration. For catastrophic cases restore a Supabase PITR backup (see [production-readiness.md](./production-readiness.md#backups-and-restore)).
