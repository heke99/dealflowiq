# Release security and operations checklist

These are release gates, not optional follow-up work. Code verification cannot configure third-party dashboards or prove a live backup restore without access to the deployment environment.

## 1. Local/isolated database gate

```bash
npx supabase start
export SUPABASE_TEST_URL=http://127.0.0.1:54321
export SUPABASE_TEST_ANON_KEY='value from supabase status -o env'
export SUPABASE_TEST_SERVICE_ROLE_KEY='value from supabase status -o env'
export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
npm run verify:release
npm run db:security:audit
```

The integration suite refuses a remote database unless `ALLOW_REMOTE_TEST_DB=YES` is explicitly set.

## 2. Existing linked Supabase project

1. Put the app in a maintenance window for auth/tenant writes.
2. Inspect `supabase migration list --linked` and compare it with `supabase/migration-version-map.csv`.
3. Create and verify a database backup.
4. Apply the guarded history reconciliation and new migration:

```bash
CONFIRM_MIGRATION_HISTORY_REWRITE=YES ./scripts/sync-supabase.sh --existing-linked-project
```

5. Run the live audit using a direct database connection:

```bash
DATABASE_URL='postgresql://...' npm run db:security:audit
```

6. Execute the integration suite only against a dedicated staging/branch database. Never run destructive integration tests against production.

## 3. Supabase Auth configuration

- Set the exact production Site URL.
- Add only documented `/auth/callback` URLs for production, staging and local development.
- Verify signup confirmation, resend confirmation and password recovery in every allowed environment.
- Keep broad wildcard redirect patterns disabled.
- Enable CAPTCHA in Supabase and set both Turnstile variables in the application.

## 4. Secrets

Rotate and redeploy any secret that has ever been committed, shared in a zip, pasted into logs or exposed to a browser bundle. At minimum review Supabase service-role keys, Stripe secrets/webhook signing secret, Resend key, cron secret and provider API keys. Confirm no production secret exists in Git history or build artifacts.

## 5. Email authentication

For the exact sending domain used by `RESEND_FROM_EMAIL`:

- SPF passes.
- DKIM passes.
- DMARC exists with an intentional policy and reporting addresses.
- Invite, password-change and account-deletion messages reach a real external mailbox.
- The email outbox worker is scheduled and dead-letter rows are monitored.

## 6. Backup and restore proof

Create a timestamped linked dump, restore it into an isolated database, apply migrations and run the security/integration gates. Record the backup identifier, restore target, start/end time and result in the release ticket.

```bash
mkdir -p backups
npx supabase db dump --linked --file "backups/pre-release-$(date +%Y%m%d-%H%M%S).sql"
# Restore the dump only into an isolated/local Postgres target, then:
npm run db:migrations:check
DATABASE_URL='postgresql://isolated-target/...' npm run db:security:audit
npm run test:integration
```

## 7. Runtime observability

Alert on repeated failures for auth callback, bootstrap, invite acceptance, ownership transfer, password change and the email outbox. Security events store hashed request metadata; logs must retain a trace/request ID while never exposing raw database errors to users.

## 8. Final approval

Do not enable external signup until all of these are green:

- `npm run verify`
- `npm audit --audit-level=moderate`
- isolated Supabase integration tests
- live/staging database security audit
- redirect/CAPTCHA verification
- email authentication and delivery verification
- documented backup restore test
