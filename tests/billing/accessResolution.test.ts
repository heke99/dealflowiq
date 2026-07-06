import { describe, expect, it } from 'vitest'
import { resolveAccessState, type BillingPlan, type OrganizationSubscription, type UserAccessOverride } from '@/lib/billing/access'

const NOW = new Date('2026-07-01T00:00:00Z').getTime()
const FUTURE = new Date('2026-08-01T00:00:00Z').toISOString()
const PAST = new Date('2026-06-01T00:00:00Z').toISOString()

function plan(overrides: Partial<BillingPlan> = {}): BillingPlan {
  return {
    id: 'plan-1',
    code: 'premium',
    name: 'Premium',
    description: null,
    monthly_price_cents: 4900,
    annual_price_cents: 49000,
    currency: 'usd',
    trial_days: 7,
    is_public: true,
    is_active: true,
    features: { deals: true, buyers: true },
    limits: { max_saved_deals: null },
    ...overrides,
  }
}

function subscription(overrides: Partial<OrganizationSubscription> = {}): OrganizationSubscription {
  return {
    id: 'sub-1',
    organization_id: 'org-1',
    plan_id: 'plan-1',
    status: 'active',
    trial_start_at: null,
    trial_end_at: null,
    current_period_start: null,
    current_period_end: null,
    trial_source: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    stripe_price_id: null,
    stripe_interval: null,
    stripe_cancel_at_period_end: null,
    notes: null,
    features_override: {},
    limits_override: {},
    plan: null,
    ...overrides,
  }
}

function override(overrides: Partial<UserAccessOverride> = {}): UserAccessOverride {
  return {
    id: 'ovr-1',
    user_id: 'user-1',
    organization_id: 'org-1',
    status: 'active',
    reason: null,
    expires_at: null,
    features_override: { white_label: true },
    limits_override: {},
    ...overrides,
  }
}

const base = {
  isPlatformAdmin: false,
  accountType: 'solo_investor' as const,
  plan: null,
  subscription: null,
  userOverride: null,
  memberOverride: null,
  now: NOW,
}

describe('resolveAccessState — access source precedence', () => {
  it('platform admin wins over everything', () => {
    const result = resolveAccessState({ ...base, isPlatformAdmin: true, plan: plan(), subscription: subscription() })
    expect(result.accessSource).toBe('platform_admin')
    expect(result.features.white_label).toBe(true)
    expect(result.limits.unlimited).toBeNull()
  })

  it('active user override wins over subscription', () => {
    const result = resolveAccessState({ ...base, plan: plan(), subscription: subscription(), userOverride: override() })
    expect(result.accessSource).toBe('user_override')
    expect(result.features.white_label).toBe(true)
  })

  it('member override applies when no user override exists', () => {
    const result = resolveAccessState({ ...base, memberOverride: override({ features_override: { ai_review: true } }) })
    expect(result.accessSource).toBe('user_override')
    expect(result.features.ai_review).toBe(true)
  })

  it('paid subscription grants subscription access', () => {
    const result = resolveAccessState({ ...base, plan: plan(), subscription: subscription() })
    expect(result.accessSource).toBe('subscription')
    expect(result.features.buyers).toBe(true)
  })

  it('active trial grants trial access', () => {
    const result = resolveAccessState({
      ...base,
      plan: plan(),
      subscription: subscription({ status: 'trialing', trial_end_at: FUTURE }),
    })
    expect(result.accessSource).toBe('trial')
    expect(result.isTrialActive).toBe(true)
  })

  it('no subscription at all falls back to free', () => {
    const result = resolveAccessState(base)
    expect(result.accessSource).toBe('free')
    expect(result.isPaymentRequired).toBe(false)
  })
})

describe('resolveAccessState — expiry', () => {
  it('expired trial falls back to free access', () => {
    const result = resolveAccessState({
      ...base,
      plan: plan(),
      subscription: subscription({ status: 'trialing', trial_end_at: PAST }),
    })
    expect(result.accessSource).toBe('free')
    expect(result.isTrialActive).toBe(false)
    expect(result.features.buyers).toBeUndefined()
  })

  it('expired user override is ignored', () => {
    const result = resolveAccessState({ ...base, userOverride: override({ expires_at: PAST }) })
    expect(result.accessSource).toBe('free')
  })

  it('expired user override does not shadow an active member override', () => {
    const result = resolveAccessState({
      ...base,
      userOverride: override({ expires_at: PAST }),
      memberOverride: override({ id: 'ovr-2', expires_at: FUTURE, features_override: { ai_review: true } }),
    })
    expect(result.accessSource).toBe('user_override')
    expect(result.activeOverride?.id).toBe('ovr-2')
  })
})

describe('resolveAccessState — payment required', () => {
  it.each(['past_due', 'unpaid', 'incomplete'])('%s status requires payment', (status) => {
    const result = resolveAccessState({ ...base, plan: plan(), subscription: subscription({ status }) })
    expect(result.accessSource).toBe('payment_required')
    expect(result.isPaymentRequired).toBe(true)
  })

  it('canceled subscription falls back to free, not payment_required', () => {
    const result = resolveAccessState({ ...base, plan: plan(), subscription: subscription({ status: 'canceled' }) })
    expect(result.accessSource).toBe('free')
  })
})

describe('resolveAccessState — free plan', () => {
  it('an active free plan resolves to free access with plan limits', () => {
    const freePlan = plan({ code: 'free', monthly_price_cents: 0, annual_price_cents: 0, limits: { max_saved_deals: 3 }, features: { market_search: true } })
    const result = resolveAccessState({ ...base, plan: freePlan, subscription: subscription({ status: 'active' }) })
    expect(result.accessSource).toBe('free')
    expect(result.limits.max_saved_deals).toBe(3)
  })
})
