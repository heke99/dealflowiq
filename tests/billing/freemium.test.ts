import { describe, expect, it } from 'vitest'
import { FREE_OPPORTUNITY_LIST_LIMIT, hasFullOpportunityAccess, opportunityListLimit } from '@/lib/billing/freemium'
import type { WorkspaceAccess } from '@/lib/billing/access'

function access(overrides: Partial<WorkspaceAccess>): WorkspaceAccess {
  return {
    accountType: 'solo_investor',
    isPlatformAdmin: false,
    subscription: null,
    plan: null,
    userOverride: null,
    accessSource: 'free',
    status: 'trialing',
    trialEndsAt: null,
    isTrialActive: false,
    isFreeAccess: true,
    isPaymentRequired: false,
    requiresPayment: false,
    restrictionReason: null,
    features: {},
    limits: {},
    ...overrides,
  }
}

describe('hasFullOpportunityAccess', () => {
  it.each(['platform_admin', 'user_override', 'subscription', 'trial'] as const)('%s has full access', (accessSource) => {
    expect(hasFullOpportunityAccess(access({ accessSource }))).toBe(true)
  })

  it.each(['free', 'payment_required', 'missing_organization'] as const)('%s does not have full access', (accessSource) => {
    expect(hasFullOpportunityAccess(access({ accessSource }))).toBe(false)
  })
})

describe('opportunityListLimit', () => {
  it('is unlimited for full-access workspaces', () => {
    expect(opportunityListLimit(access({ accessSource: 'subscription' }))).toBeNull()
  })

  it('uses the plan limit for free workspaces', () => {
    expect(opportunityListLimit(access({ accessSource: 'free', limits: { max_visible_opportunities: 5 } }))).toBe(5)
  })

  it('falls back to the free default when the limit is missing', () => {
    expect(opportunityListLimit(access({ accessSource: 'free' }))).toBe(FREE_OPPORTUNITY_LIST_LIMIT)
  })
})
