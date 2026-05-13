import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isCurrentUserPlatformAdmin } from '@/lib/auth/admin'
import { normalizeAccountType, type AccountType } from '@/lib/product/accountTypes'
import { ALL_FEATURES, CORE_FEATURES, accountTypeDefaultFeatures, mergeFeatures, type FeatureMap, type LimitMap } from '@/lib/billing/features'

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

export type WorkspaceAccess = {
  accountType: AccountType
  isPlatformAdmin: boolean
  subscription: OrganizationSubscription | null
  plan: BillingPlan | null
  status: string
  trialEndsAt: string | null
  isTrialActive: boolean
  features: FeatureMap
  limits: LimitMap
}

function parseObject<T extends Record<string, unknown>>(value: unknown, fallback: T): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback
  return value as T
}

export async function getWorkspaceAccess(params: {
  organizationId?: string | null
  accountType?: string | null
}): Promise<WorkspaceAccess> {
  const accountType = normalizeAccountType(params.accountType)
  const isPlatformAdmin = await isCurrentUserPlatformAdmin()
  const defaultFeatures = mergeFeatures(CORE_FEATURES, accountTypeDefaultFeatures[accountType])

  if (!params.organizationId) {
    return {
      accountType,
      isPlatformAdmin,
      subscription: null,
      plan: null,
      status: 'missing_organization',
      trialEndsAt: null,
      isTrialActive: false,
      features: isPlatformAdmin ? ALL_FEATURES : defaultFeatures,
      limits: isPlatformAdmin ? { unlimited: null } : {},
    }
  }

  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('organization_subscriptions')
    .select('id, organization_id, plan_id, status, trial_start_at, trial_end_at, current_period_start, current_period_end, trial_source, notes, features_override, limits_override, billing_plans(id, code, name, description, monthly_price_cents, annual_price_cents, currency, trial_days, is_public, is_active, features, limits)')
    .eq('organization_id', params.organizationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const row = data as any
  const rawPlan = Array.isArray(row?.billing_plans) ? row.billing_plans[0] : row?.billing_plans
  const plan: BillingPlan | null = rawPlan
    ? {
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
    : null

  const subscription: OrganizationSubscription | null = row
    ? {
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
    : null

  const status = subscription?.status || 'trialing'
  const trialEndsAt = subscription?.trial_end_at || null
  const isTrialActive = Boolean(status === 'trialing' && trialEndsAt && new Date(trialEndsAt).getTime() > Date.now())
  const features = isPlatformAdmin
    ? ALL_FEATURES
    : mergeFeatures(CORE_FEATURES, defaultFeatures, plan?.features, subscription?.features_override)
  const limits = isPlatformAdmin
    ? ({ unlimited: null } as LimitMap)
    : ({ ...(plan?.limits || {}), ...(subscription?.limits_override || {}) } as LimitMap)

  return {
    accountType,
    isPlatformAdmin,
    subscription,
    plan,
    status,
    trialEndsAt,
    isTrialActive,
    features,
    limits,
  }
}
