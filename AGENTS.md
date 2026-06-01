<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

Multi-repo workspace root: `/agent/repos/`. This app lives at `/agent/repos/dealflowiq`.

- **Install:** `npm install` in this directory.
- **Env:** Create `.env.local` with at least `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `NEXT_PUBLIC_SITE_URL` or `NEXT_PUBLIC_APP_URL` for auth redirects. Apply SQL under `supabase/migrations/` to a hosted Supabase project (no `supabase/config.toml` in-repo).
- **Dev:** `npm run dev`. Use `PORT` when multiple apps run in parallel.
- **Lint / build:** `npm run lint`, `npm run build`. As of setup verification, `npm run build` can fail on a pre-existing TypeScript error in `lib/billing/access.ts` (`LimitMap` / `undefined`); dev server still starts with placeholder env.
- **Tests:** No `test` script in `package.json`.
