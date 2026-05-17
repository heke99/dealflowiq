import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isCurrentUserPlatformAdmin } from '@/lib/auth/admin'
import { normalizeAccountType, type AccountType } from '@/lib/product/accountTypes'
import { ALL_FEATURES, accountTypeDefaultFeatures, mergeFeatures, type FeatureMap, type LimitMap } from '@/lib/billing/features'

export type BillingPlan = {
  id: string
  code: string
  name: string
  description: string | null
  monthly_price_cents: number | null
  annual_price_cents: number | null
  currency: string
  trial_days: number
  is_public: boolean
  is_active: boolean
  features: FeatureMap
  limits: LimitMap
}

export type OrganizationSubscription = {
  id: string
  organization_id: string
  plan_id: string | null
  status: string
  trial_start_at: string | null
  trial_end_at: string | null
  current_period_start: string | null
  current_period_end: string | null
  trial_source: string | null
  notes: string | null
  features_override: FeatureMap | null
  limits_override: Partial<LimitMap> | null
  plan: BillingPlan | null
}

export type MemberAccessOverride = {
  id: string
  organization_id: string
  user_id: string
  status: 'full_access' | 'restricted' | 'revoked'
  starts_at: string | null
  expires_at: string | null
  features_override: FeatureMap | null
  limits_override: Partial<LimitMap> | null
  notes: string | null
}

export type WorkspaceAccess = {
  accountType: AccountType
  isPlatformAdmin: boolean
  subscription: OrganizationSubscription | null
  plan: BillingPlan | null
  memberOverride: MemberAccessOverride | null
  status: string
  accessLevel: 'platform_admin' | 'member_override' | 'trial' | 'subscription' | 'restricted'
  trialEndsAt: string | null
  isTrialActive: boolean
  isAccessActive: boolean
  requiresPayment: boolean
  restrictionReason: string | null
  features: FeatureMap
  limits: LimitMap
}

function parseObject<T extends Record<string, unknown>>(value: unknown, fallback: T): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback
  return value as T
}

function isFuture(value?: string | null) {
  if (!value) return false
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) && timestamp > Date.now()
}

function hasStarted(value?: string | null) {
  if (!value) return true
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) && timestamp <= Date.now()
}

function hasNotEnded(value?: string | null) {
  if (!value) return true
  return isFuture(value)
}

function normalizePlan(rawPlan: any): BillingPlan | null {
  if (!rawPlan) return null
  return {
    id: rawPlan.id,
    code: rawPlan.code,
    name: rawPlan.name,
    description: rawPlan.description,
    monthly_price_cents: rawPlan.monthly_price_cents,
    annual_price_cents: rawPlan.annual_price_cents,
    currency: rawPlan.currency || 'usd',
    trial_days: Number(rawPlan.trial_days || 0),
    is_public: Boolean(rawPlan.is_public),
    is_active: Boolean(rawPlan.is_active),
    features: parseObject<FeatureMap>(rawPlan.features, {}),
    limits: parseObject<LimitMap>(rawPlan.limits, {}),
  }
}

function normalizeSubscription(row: any, plan: BillingPlan | null): OrganizationSubscription | null {
  if (!row) return null
  return {
    id: row.id,
    organization_id: row.organization_id,
    plan_id: row.plan_id,
    status: row.status,
    trial_start_at: row.trial_start_at,
    trial_end_at: row.trial_end_at,
    current_period_start: row.current_period_start,
    current_period_end: row.current_period_end,
    trial_source: row.trial_source,
    notes: row.notes,
    features_override: parseObject<FeatureMap>(row.features_override, {}),
    limits_override: parseObject<Partial<LimitMap>>(row.limits_override, {}),
    plan,
  }
}

function normalizeMemberOverride(row: any): MemberAccessOverride | null {
  if (!row) return null
  return {
    id: row.id,
    organization_id: row.organization_id,
    user_id: row.user_id,
    status: row.status,
    starts_at: row.starts_at,
    expires_at: row.expires_at,
    features_override: parseObject<FeatureMap>(row.features_override, {}),
    limits_override: parseObject<Partial<LimitMap>>(row.limits_override, {}),
    notes: row.notes,
  }
}

export async function getWorkspaceAccess(params: {
  organizationId?: string | null
  userId?: string | null
  accountType?: string | null
}): Promise<WorkspaceAccess> {
  const accountType = normalizeAccountType(params.accountType)
  const isPlatformAdmin = await isCurrentUserPlatformAdmin()

  if (isPlatformAdmin) {
    return {
      accountType,
      isPlatformAdmin: true,
      subscription: null,
      plan: null,
      memberOverride: null,
      status: 'platform_admin',
      accessLevel: 'platform_admin',
      trialEndsAt: null,
      isTrialActive: false,
      isAccessActive: true,
      requiresPayment: false,
      restrictionReason: null,
      features: ALL_FEATURES,
      limits: { unlimited: null },
    }
  }

  if (!params.organizationId) {
    return {
      accountType,
      isPlatformAdmin: false,
      subscription: null,
      plan: null,
      memberOverride: null,
      status: 'missing_organization',
      accessLevel: 'restricted',
      trialEndsAt: null,
      isTrialActive: false,
      isAccessActive: false,
      requiresPayment: true,
      restrictionReason: 'No workspace is connected to this user yet.',
      features: {},
      limits: {},
    }
  }

  const supabase = await createSupabaseServerClient()
  const [{ data }, overrideResult] = await Promise.all([
    supabase
      .from('organization_subscriptions')
      .select('id, organization_id, plan_id, status, trial_start_at, trial_end_at, current_period_start, current_period_end, trial_source, notes, features_override, limits_override, billing_plans(id, code, name, description, monthly_price_cents, annual_price_cents, currency, trial_days, is_public, is_active, features, limits)')
      .eq('organization_id', params.organizationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    params.userId
      ? supabase
          .from('member_access_overrides')
          .select('id, organization_id, user_id, status, starts_at, expires_at, features_override, limits_override, notes')
          .eq('organization_id', params.organizationId)
          .eq('user_id', params.userId)
          .in('status', ['full_access', 'restricted'])
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

  const row = data as any
  const rawPlan = Array.isArray(row?.billing_plans) ? row.billing_plans[0] : row?.billing_plans
  const plan = normalizePlan(rawPlan)
  const subscription = normalizeSubscription(row, plan)
  const memberOverride = normalizeMemberOverride((overrideResult as any)?.data)
  const overrideActive = Boolean(
    memberOverride?.status === 'full_access' &&
    hasStarted(memberOverride.starts_at) &&
    hasNotEnded(memberOverride.expires_at),
  )
  const overrideRestricted = Boolean(
    memberOverride?.status === 'restricted' &&
    hasStarted(memberOverride.starts_at) &&
    hasNotEnded(memberOverride.expires_at),
  )

  if (overrideActive) {
    return {
      accountType,
      isPlatformAdmin: false,
      subscription,
      plan,
      memberOverride,
      status: 'member_full_access',
      accessLevel: 'member_override',
      trialEndsAt: subscription?.trial_end_at || null,
      isTrialActive: false,
      isAccessActive: true,
      requiresPayment: false,
      restrictionReason: null,
      features: mergeFeatures(ALL_FEATURES, memberOverride?.features_override),
      limits: { unlimited: null, ...(memberOverride?.limits_override || {}) },
    }
  }

  const rawStatus = subscription?.status || 'missing_subscription'
  const trialEndsAt = subscription?.trial_end_at || null
  const isTrialActive = Boolean(rawStatus === 'trialing' && isFuture(trialEndsAt))
  const activeSubscription = ['active', 'comped', 'manually_granted'].includes(rawStatus) && hasNotEnded(subscription?.current_period_end)
  const isAccessActive = !overrideRestricted && (isTrialActive || activeSubscription)

  let status = rawStatus
  let accessLevel: WorkspaceAccess['accessLevel'] = 'restricted'
  let restrictionReason: string | null = null

  if (overrideRestricted) {
    status = 'restricted_by_admin'
    restrictionReason = memberOverride?.notes || 'Access has been restricted by platform admin.'
  } else if (isTrialActive) {
    status = 'trialing'
    accessLevel = 'trial'
  } else if (activeSubscription) {
    accessLevel = 'subscription'
  } else if (rawStatus === 'trialing') {
    status = 'trial_expired'
    restrictionReason = 'Your 7-day trial has ended. Choose a subscription to continue.'
  } else if (rawStatus === 'past_due') {
    restrictionReason = 'Payment is past due. Update billing or ask admin to restore access.'
  } else if (rawStatus === 'canceled') {
    restrictionReason = 'This subscription is canceled.'
  } else if (rawStatus === 'expired') {
    restrictionReason = 'This subscription has expired.'
  } else if (rawStatus === 'missing_subscription') {
    restrictionReason = 'No subscription record exists for this workspace.'
  } else {
    restrictionReason = 'A valid subscription is required to use this workspace.'
  }

  const features = isTrialActive
    ? ALL_FEATURES
    : isAccessActive
      ? mergeFeatures(accountTypeDefaultFeatures[accountType], plan?.features, subscription?.features_override)
      : {}

  const limits = isTrialActive
    ? ({ unlimited: null } as LimitMap)
    : isAccessActive
      ? ({ ...(plan?.limits || {}), ...(subscription?.limits_override || {}) } as LimitMap)
      : {}

  return {
    accountType,
    isPlatformAdmin: false,
    subscription,
    plan,
    memberOverride,
    status,
    accessLevel,
    trialEndsAt,
    isTrialActive,
    isAccessActive,
    requiresPayment: !isAccessActive,
    restrictionReason,
    features,
    limits,
  }
}
