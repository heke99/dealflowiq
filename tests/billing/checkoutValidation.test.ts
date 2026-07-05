import { describe, expect, it } from 'vitest'
import { validateCheckoutPlan } from '@/lib/billing/checkoutValidation'

const paidPlan = {
  id: 'plan-1',
  code: 'premium',
  is_active: true,
  is_public: true,
  monthly_price_cents: 4900,
  annual_price_cents: 49000,
  trial_days: 7,
}

describe('validateCheckoutPlan', () => {
  it('rejects a missing plan', () => {
    expect(validateCheckoutPlan({ plan: null, interval: 'month' })).toEqual({ ok: false, reason: 'Plan not found.' })
  })

  it('rejects an inactive plan', () => {
    const result = validateCheckoutPlan({ plan: { ...paidPlan, is_active: false }, interval: 'month' })
    expect(result.ok).toBe(false)
  })

  it('rejects direct purchase of a non-public plan', () => {
    const result = validateCheckoutPlan({ plan: { ...paidPlan, is_public: false }, interval: 'month' })
    expect(result.ok).toBe(false)
  })

  it('allows keeping a non-public plan the org already has', () => {
    const result = validateCheckoutPlan({
      plan: { ...paidPlan, is_public: false },
      interval: 'month',
      current: { plan_id: 'plan-1', status: 'canceled', stripe_subscription_id: null },
    })
    expect(result.ok).toBe(true)
  })

  it('uses the interval-specific price', () => {
    const monthly = validateCheckoutPlan({ plan: paidPlan, interval: 'month' })
    const annual = validateCheckoutPlan({ plan: paidPlan, interval: 'year' })
    expect(monthly).toMatchObject({ ok: true, priceCents: 4900 })
    expect(annual).toMatchObject({ ok: true, priceCents: 49000 })
  })

  it('flags free plans', () => {
    const result = validateCheckoutPlan({ plan: { ...paidPlan, monthly_price_cents: 0 }, interval: 'month' })
    expect(result).toMatchObject({ ok: true, isFree: true })
  })

  it('rejects a second checkout for an already-live Stripe subscription on the same plan', () => {
    const result = validateCheckoutPlan({
      plan: paidPlan,
      interval: 'month',
      current: { plan_id: 'plan-1', status: 'active', stripe_subscription_id: 'sub_123' },
    })
    expect(result.ok).toBe(false)
  })

  it('allows switching plans even with a live subscription (Stripe replaces it)', () => {
    const result = validateCheckoutPlan({
      plan: paidPlan,
      interval: 'month',
      current: { plan_id: 'other-plan', status: 'active', stripe_subscription_id: 'sub_123' },
    })
    expect(result.ok).toBe(true)
  })

  it('grants trial days only when the org never had a trial', () => {
    const fresh = validateCheckoutPlan({ plan: paidPlan, interval: 'month', current: { plan_id: null, status: 'canceled', trial_start_at: null } })
    const used = validateCheckoutPlan({ plan: paidPlan, interval: 'month', current: { plan_id: null, status: 'canceled', trial_start_at: '2026-01-01T00:00:00Z' } })
    expect(fresh).toMatchObject({ ok: true, trialDays: 7 })
    expect(used).toMatchObject({ ok: true, trialDays: 0 })
  })
})
