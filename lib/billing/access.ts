import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isCurrentUserPlatformAdmin } from '@/lib/auth/admin'
import { normalizeAccountType, type AccountType } from '@/lib/product/accountTypes'
import { ALL_FEATURES, CORE_FEATURES, FREE_FEATURES, FREE_LIMITS, TRIAL_LIMITS, accountTypeDefaultFeatures, mergeFeatures, type FeatureMap, type LimitMap } from '@/lib/billing/features'

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

export type UserAccessOverride = {
  id: string
  user_id: string
  organization_id: string | null
  status: string
  reason: string | null
  expires_at: string | null
  features_override: FeatureMap | null
  limits_override: Partial<LimitMap> | null
}

export type AccessSource = 'platform_admin' | 'user_override' | 'subscription' | 'trial' | 'free' | 'payment_required' | 'missing_organization'

export type WorkspaceAccess = {
  accountType: AccountType
  isPlatformAdmin: boolean
  subscription: OrganizationSubscription | null
  plan: BillingPlan | null
  userOverride: UserAccessOverride | null
  accessSource: AccessSource
  status: string
  trialEndsAt: string | null
  isTrialActive: boolean
  isFreeAccess: boolean
  isPaymentRequired: boolean
  requiresPayment: boolean
  restrictionReason: string | null
  features: FeatureMap
  limits: LimitMap
}

function parseObject<T extends Record<string, unknown>>(value: unknown, fallback: T): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback
  return value as T
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

function getRestrictionReason(accessSource: AccessSource, status: string, hasOrganization: boolean): string | null {
  if (!hasOrganization) return 'No workspace is connected to this user yet.'
  if (accessSource === 'payment_required') {
    if (status === 'past_due') return 'Payment is past due. Update billing or ask admin to restore access.'
    if (status === 'unpaid') return 'Payment is unpaid. Update billing or ask admin to restore access.'
    if (status === 'incomplete') return 'Payment setup is incomplete. Complete billing or ask admin to activate access.'
    return 'A valid subscription or admin override is required to continue using premium workspace features.'
  }
  return null
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

export async function getWorkspaceAccess(params: {
  organizationId?: string | null
  accountType?: string | null
  userId?: string | null
}): Promise<WorkspaceAccess> {
  const accountType = normalizeAccountType(params.accountType)
  const isPlatformAdmin = await isCurrentUserPlatformAdmin()
  const defaultFeatures = mergeFeatures(CORE_FEATURES, accountTypeDefaultFeatures[accountType])
  const fullLimits = { unlimited: null, ...TRIAL_LIMITS }

  if (!params.organizationId) {
    return {
      accountType,
      isPlatformAdmin,
      subscription: null,
      plan: null,
      userOverride: null,
      accessSource: isPlatformAdmin ? 'platform_admin' : 'missing_organization',
      status: isPlatformAdmin ? 'platform_admin' : 'missing_organization',
      trialEndsAt: null,
      isTrialActive: false,
      isFreeAccess: !isPlatformAdmin,
      isPaymentRequired: !isPlatformAdmin,
      requiresPayment: !isPlatformAdmin,
      restrictionReason: getRestrictionReason(isPlatformAdmin ? 'platform_admin' : 'missing_organization', isPlatformAdmin ? 'platform_admin' : 'missing_organization', false),
      features: isPlatformAdmin ? ALL_FEATURES : FREE_FEATURES,
      limits: isPlatformAdmin ? fullLimits : FREE_LIMITS,
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
          .from('user_access_overrides')
          .select('id, user_id, organization_id, status, reason, expires_at, features_override, limits_override')
          .eq('user_id', params.userId)
          .eq('status', 'active')
          .or(`organization_id.eq.${params.organizationId},organization_id.is.null`)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const row = data as any
  const rawPlan = Array.isArray(row?.billing_plans) ? row.billing_plans[0] : row?.billing_plans
  const plan = normalizePlan(rawPlan)
  const subscription = normalizeSubscription(row, plan)
  const overrideRow = overrideResult.data as any
  const userOverride: UserAccessOverride | null = overrideRow
    ? {
        id: overrideRow.id,
        user_id: overrideRow.user_id,
        organization_id: overrideRow.organization_id,
        status: overrideRow.status,
        reason: overrideRow.reason,
        expires_at: overrideRow.expires_at,
        features_override: parseObject<FeatureMap>(overrideRow.features_override, {}),
        limits_override: parseObject<Partial<LimitMap>>(overrideRow.limits_override, {}),
      }
    : null

  const status = subscription?.status || 'trialing'
  const trialEndsAt = subscription?.trial_end_at || null
  const isTrialActive = Boolean(status === 'trialing' && trialEndsAt && new Date(trialEndsAt).getTime() > Date.now())
  const isOverrideActive = Boolean(userOverride && (!userOverride.expires_at || new Date(userOverride.expires_at).getTime() > Date.now()))
  const isSubscriptionActive = ['active', 'paid', 'comped'].includes(status)

  let accessSource: AccessSource = 'free'
  let features: FeatureMap = FREE_FEATURES
  let limits: LimitMap = FREE_LIMITS

  if (isPlatformAdmin) {
    accessSource = 'platform_admin'
    features = ALL_FEATURES
    limits = fullLimits
  } else if (isOverrideActive) {
    accessSource = 'user_override'
    features = mergeFeatures(defaultFeatures, plan?.features, userOverride?.features_override)
    limits = { ...(plan?.limits || {}), ...fullLimits, ...(userOverride?.limits_override || {}) }
  } else if (isSubscriptionActive) {
    accessSource = 'subscription'
    features = mergeFeatures(defaultFeatures, plan?.features, subscription?.features_override)
    limits = { ...(plan?.limits || {}), ...fullLimits, ...(subscription?.limits_override || {}) }
  } else if (isTrialActive) {
    accessSource = 'trial'
    features = mergeFeatures(defaultFeatures, plan?.features, subscription?.features_override)
    limits = { ...(plan?.limits || {}), ...fullLimits, ...(subscription?.limits_override || {}) }
  } else if (['past_due', 'unpaid', 'incomplete'].includes(status)) {
    accessSource = 'payment_required'
  }

  const isPaymentRequired = accessSource === 'payment_required'
  const restrictionReason = getRestrictionReason(accessSource, status, true)

  return {
    accountType,
    isPlatformAdmin,
    subscription,
    plan,
    userOverride,
    accessSource,
    status,
    trialEndsAt,
    isTrialActive,
    isFreeAccess: accessSource === 'free',
    isPaymentRequired,
    requiresPayment: isPaymentRequired,
    restrictionReason,
    features,
    limits,
  }
}
