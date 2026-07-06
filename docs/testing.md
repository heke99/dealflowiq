# Testing

The suite uses [Vitest](https://vitest.dev) with the `@` path alias (see `vitest.config.ts`). Tests live in `tests/**/*.test.ts` and target the pure business-logic layer, so no database, Stripe account or network access is required.

## Commands

```bash
npm run test         # single run (CI)
npm run test:watch   # watch mode
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
```

## What is covered

| Area | Suites |
|---|---|
| Billing | feature/limit merging, access-source resolution + trial/override expiry, checkout validation, webhook idempotency decisions, freemium gates |
| Authorization | plan-limit evaluation, safe redirect paths |
| Imports | provider detection, search/listing classification, URL analysis, dedupe keys, URL-only fallback listings, CSV parsing, provider policy defaults/overrides |
| Scoring | score determinism + NaN guards, opportunity classification, review status, suggested next actions, buy-box criteria matching |
| Underwriting | amortization, NOI/DSCR/cap-rate/CoC/break-even formulas, flip/wholesale/BRRRR previews, input guardrails, snapshot payloads |
| Rent intelligence | rent guardrails, comp summarization (IQR outliers, confidence) |
| Deals | listing→deal and deal→listing mappings, status normalization, duplicate payloads |
| Matching | buyer↔listing scoring, thresholds, mismatch reasons, shared utils |
| Community | invite display status and acceptance rules |
| Observability | user-safe error sanitization |

## Conventions

- Test pure functions. When a server action contains meaningful logic, extract it into `lib/` and test the extraction (see `lib/deals/`, `lib/matching/`, `lib/billing/checkoutValidation.ts`).
- Inject clocks (`now` parameters) instead of mocking timers where expiry matters.
- No `any` in tests; use the same row helpers as production code.

## CI

Run `npm ci && npm run build && npm run lint && npm run test` — all four must pass. There is no separate CI config in the repo yet; wire these commands into your CI provider of choice.
