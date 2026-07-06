import type { StripeBillingInterval } from '@/lib/billing/stripe'

export type CheckoutPlanCandidate = {
  id: string
  code?: string | null
  name?: string | null
  is_active?: boolean | null
  is_public?: boolean | null
  monthly_price_cents?: number | null
  annual_price_cents?: number | null
  trial_days?: number | null
}

export type CurrentSubscriptionState = {
  plan_id?: string | null
  status?: string | null
  stripe_subscription_id?: string | null
  trial_start_at?: string | null
}

export type CheckoutValidationResult =
  | { ok: true; priceCents: number; isFree: boolean; trialDays: number }
  | { ok: false; reason: string }

const LIVE_STRIPE_STATUSES = ['active', 'trialing', 'past_due', 'incomplete', 'unpaid']

/**
 * Pure checkout validation shared by the billing action and tests.
 * Rules:
 * - the plan must exist and be active
 * - non-public plans can only be kept, not newly purchased (they are assigned
 *   by platform admins)
 * - a live Stripe subscription on the same plan should be managed through the
 *   billing portal instead of a second checkout
 * - plan trial days apply only when the org never had a trial before
 */
export function validateCheckoutPlan(params: {
  plan: CheckoutPlanCandidate | null
  interval: StripeBillingInterval
  current?: CurrentSubscriptionState | null
}): CheckoutValidationResult {
  const { plan, interval, current } = params
  if (!plan) return { ok: false, reason: 'Plan not found.' }
  if (plan.is_active === false) return { ok: false, reason: 'This plan is no longer available.' }

  const isCurrentPlan = Boolean(current?.plan_id && current.plan_id === plan.id)
  if (plan.is_public === false && !isCurrentPlan) {
    return { ok: false, reason: 'This plan is assigned by an administrator and cannot be purchased directly.' }
  }

  const priceCents = interval === 'year' ? Number(plan.annual_price_cents || 0) : Number(plan.monthly_price_cents || 0)
  const isFree = priceCents <= 0

  const hasLiveStripeSubscription = Boolean(
    current?.stripe_subscription_id && LIVE_STRIPE_STATUSES.includes(String(current.status || ''))
  )
  if (!isFree && hasLiveStripeSubscription && isCurrentPlan) {
    return { ok: false, reason: 'You already have an active subscription on this plan. Use the billing portal to manage it.' }
  }

  const hadTrialBefore = Boolean(current?.trial_start_at)
  const trialDays = !isFree && !hadTrialBefore ? Math.max(0, Number(plan.trial_days || 0)) : 0

  return { ok: true, priceCents, isFree, trialDays }
}
