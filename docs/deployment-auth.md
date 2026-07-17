# Auth, redirects and release configuration

## Canonical application URL

Set `APP_URL` to the exact public origin for each environment. All auth callbacks, invite links and Stripe redirects use `getCanonicalAppUrl()`.

- Production: `https://app.example.com`
- Staging: `https://staging.example.com`
- Local: `http://localhost:3000`

`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SITE_URL` and `VERCEL_URL` are compatibility fallbacks only. Do not configure more than one conflicting production origin.

## Supabase Auth redirect allowlist

Add only the exact callback origins used by the environment:

- `https://app.example.com/auth/callback`
- `https://staging.example.com/auth/callback`
- `http://localhost:3000/auth/callback`

Preview deployments must use a deliberately constrained wildcard or an explicit allowlist. Never allow arbitrary external `next` URLs; the application accepts internal relative paths only.

## CAPTCHA and rate limiting

Configure both:

- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`

The server also enforces database-backed limits for signup, login, recovery, resend, invite validation and invite acceptance. CAPTCHA is additive and is not the only control.

## Email outbox worker

Configure `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `CRON_SECRET`, and schedule:

```text
GET /api/cron/email-outbox
Authorization: Bearer <CRON_SECRET>
```

The worker atomically claims rows through `claim_email_outbox`, sends them, retries with backoff and moves exhausted rows to `dead_letter`.

## Release gates

Normal local verification:

```bash
npm run verify
npm audit --audit-level=moderate
```

Full release verification against an isolated local Supabase stack:

```bash
export SUPABASE_TEST_URL=http://127.0.0.1:54321
export SUPABASE_TEST_ANON_KEY='...'
export SUPABASE_TEST_SERVICE_ROLE_KEY='...'
npm run verify:release
```

The integration suite refuses a remote database unless `ALLOW_REMOTE_TEST_DB=YES` is set deliberately.
