'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePlatformAdmin } from '@/lib/auth/admin'
import { FEATURE_KEYS, type FeatureMap } from '@/lib/billing/features'
import { ACCOUNT_TYPES } from '@/lib/product/accountTypes'
import { syncPlanWithStripe } from '@/lib/billing/stripe'

const SUBSCRIPTION_STATUSES = new Set(['trialing', 'active', 'past_due', 'canceled', 'expired', 'comped', 'manually_granted', 'incomplete', 'unpaid'])
const ACTIVE_OR_BILLING_STATUSES = ['trialing', 'active', 'past_due', 'comped', 'manually_granted', 'incomplete', 'unpaid']

function toCents(value: FormDataEntryValue | null) {
  const numberValue = Number(String(value || '0').replace(',', '.'))
  if (!Number.isFinite(numberValue) || numberValue < 0) return 0
  return Math.round(numberValue * 100)
}

function toInt(value: FormDataEntryValue | null, fallback = 0) {
  const numberValue = Number(String(value || '').trim())
  if (!Number.isFinite(numberValue)) return fallback
  return Math.max(0, Math.round(numberValue))
}

function normalizeCode(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
}

function parseFeatures(formData: FormData): FeatureMap {
  return FEATURE_KEYS.reduce<FeatureMap>((acc, feature) => {
    acc[feature] = formData.get(`feature_${feature}`) === 'on'
    return acc
  }, {})
}

function parseAccountTypes(formData: FormData) {
  return ACCOUNT_TYPES.filter((accountType) => formData.get(`account_${accountType}`) === 'on')
}

function parseLimits(formData: FormData) {
  return {
    max_deals: toInt(formData.get('max_deals'), 25),
    max_buyers: toInt(formData.get('max_buyers'), 0),
    max_team_members: toInt(formData.get('max_team_members'), 1),
    max_hud_lookups: toInt(formData.get('max_hud_lookups'), 100),
    max_ai_reviews: toInt(formData.get('max_ai_reviews'), 0),
    max_deal_landing_pages: toInt(formData.get('max_deal_landing_pages'), 5),
    max_community_members: toInt(formData.get('max_community_members'), 0),
    max_imports_per_month: toInt(formData.get('max_imports_per_month'), 100),
    max_imports_per_7_days: toInt(formData.get('max_imports_per_7_days'), 1),
    max_visible_opportunities: toInt(formData.get('max_visible_opportunities'), 2),
    opportunity_detail_cooldown_hours: toInt(formData.get('opportunity_detail_cooldown_hours'), 48),
  }
}

function normalizeStatus(value: FormDataEntryValue | null) {
  const status = String(value || 'active').trim()
  return SUBSCRIPTION_STATUSES.has(status) ? status : 'active'
}

function getPeriodEnd(days: number) {
  if (days <= 0) return null
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

async function getActorId() {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.auth.getUser()
  return data.user?.id || null
}

function refreshAdminPaths() {
  revalidatePath('/admin')
  revalidatePath('/admin/plans')
  revalidatePath('/plans')
  revalidatePath('/settings/billing')
  revalidatePath('/dashboard')
}

async function loadPlanById(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, id: string) {
  const { data, error } = await supabase.from('billing_plans').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data as Record<string, any> | null
}

async function persistStripeSync(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, plan: Record<string, any>, force?: { forceMonthlyPrice?: boolean; forceAnnualPrice?: boolean }) {
  const sync = await syncPlanWithStripe(plan as any, force)
  const { error } = await supabase.from('billing_plans').update(sync).eq('id', plan.id)
  if (error) throw new Error(error.message)
  return sync
}

export async function savePlanAction(formData: FormData) {
  await requirePlatformAdmin()

  const supabase = await createSupabaseServerClient()
  const actorId = await getActorId()
  const id = String(formData.get('id') || '').trim()
  const name = String(formData.get('name') || '').trim()
  const code = normalizeCode(String(formData.get('code') || name))
  const description = String(formData.get('description') || '').trim()
  const currency = String(formData.get('currency') || 'usd').trim().toLowerCase() || 'usd'
  const monthlyPriceCents = toCents(formData.get('monthly_price'))
  const annualPriceCents = toCents(formData.get('annual_price'))
  const displayOrder = toInt(formData.get('display_order'), 100)
  const trialDays = toInt(formData.get('trial_days'), code === 'premium' ? 7 : 0)
  const isPublic = formData.get('is_public') === 'on'
  const isActive = formData.get('is_active') === 'on'
  const accountTypes = parseAccountTypes(formData)
  const features = parseFeatures(formData)
  const limits = parseLimits(formData)

  if (!name || !code) {
    redirect('/admin/plans?error=Plan name and code are required')
  }

  const previous = id ? await loadPlanById(supabase, id) : null
  const forceMonthlyPrice = Boolean(previous && Number(previous.monthly_price_cents || 0) !== monthlyPriceCents)
  const forceAnnualPrice = Boolean(previous && Number(previous.annual_price_cents || 0) !== annualPriceCents)

  const payload = {
    name,
    code,
    description: description || null,
    currency,
    monthly_price_cents: monthlyPriceCents,
    annual_price_cents: annualPriceCents,
    trial_days: trialDays,
    display_order: displayOrder,
    is_public: isPublic,
    is_active: isActive,
    account_types: accountTypes,
    features,
    limits,
    updated_by: actorId,
    ...(forceMonthlyPrice ? { stripe_monthly_price_id: null } : {}),
    ...(forceAnnualPrice ? { stripe_annual_price_id: null } : {}),
    ...(id ? {} : { created_by: actorId }),
  }

  const response = id
    ? await supabase.from('billing_plans').update(payload).eq('id', id).select('*').single()
    : await supabase.from('billing_plans').insert(payload).select('*').single()

  if (response.error || !response.data) {
    redirect(`/admin/plans?error=${encodeURIComponent(response.error?.message || 'Could not save plan')}`)
  }

  try {
    await persistStripeSync(supabase, response.data as any, { forceMonthlyPrice, forceAnnualPrice })
  } catch (error) {
    redirect(`/admin/plans?error=${encodeURIComponent(error instanceof Error ? error.message : 'Plan saved but Stripe sync failed')}`)
  }

  refreshAdminPaths()
  redirect('/admin/plans?saved=1')
}

export async function syncPlanStripeAction(formData: FormData) {
  await requirePlatformAdmin()
  const planId = String(formData.get('plan_id') || '').trim()
  if (!planId) redirect('/admin/plans?error=Plan ID is required')
  const supabase = await createSupabaseServerClient()
  const plan = await loadPlanById(supabase, planId)
  if (!plan) redirect('/admin/plans?error=Plan not found')
  try {
    await persistStripeSync(supabase, plan)
  } catch (error) {
    redirect(`/admin/plans?error=${encodeURIComponent(error instanceof Error ? error.message : 'Stripe sync failed')}`)
  }
  refreshAdminPaths()
  redirect('/admin/plans?saved=stripe')
}

export async function deletePlanAction(formData: FormData) {
  await requirePlatformAdmin()

  const planId = String(formData.get('plan_id') || '').trim()
  const replacementPlanId = String(formData.get('replacement_plan_id') || '').trim() || null
  if (!planId) redirect('/admin/plans?error=Plan ID is required')
  if (replacementPlanId === planId) redirect('/admin/plans?error=Replacement plan must be different')

  const supabase = await createSupabaseServerClient()
  const [{ count, error: countError }, { count: activeCount, error: activeCountError }, { count: stripeActiveCount, error: stripeActiveCountError }] = await Promise.all([
    supabase.from('organization_subscriptions').select('id', { count: 'exact', head: true }).eq('plan_id', planId),
    supabase.from('organization_subscriptions').select('id', { count: 'exact', head: true }).eq('plan_id', planId).in('status', ACTIVE_OR_BILLING_STATUSES),
    supabase.from('organization_subscriptions').select('id', { count: 'exact', head: true }).eq('plan_id', planId).in('status', ACTIVE_OR_BILLING_STATUSES).not('stripe_subscription_id', 'is', null),
  ])

  if (countError || activeCountError || stripeActiveCountError) redirect(`/admin/plans?error=${encodeURIComponent(countError?.message || activeCountError?.message || stripeActiveCountError?.message || 'Could not check plan usage')}`)

  if ((activeCount || 0) > 0 && (!replacementPlanId || (stripeActiveCount || 0) > 0)) {
    const { error } = await supabase
      .from('billing_plans')
      .update({
        is_active: false,
        is_public: false,
        archived_at: new Date().toISOString(),
        stripe_sync_status: 'archived',
        stripe_last_error: (stripeActiveCount || 0) > 0 ? 'Archived instead of deleted because active Stripe subscriptions are assigned to this plan. Migrate Stripe subscription items before deleting.' : 'Archived instead of deleted because active subscriptions are assigned to this plan.',
      })
      .eq('id', planId)
    if (error) redirect(`/admin/plans?error=${encodeURIComponent(error.message)}`)
    refreshAdminPaths()
    redirect('/admin/plans?saved=archived')
  }

  if ((count || 0) > 0 && replacementPlanId) {
    const { error: syncError } = await supabase
      .from('organization_subscriptions')
      .update({
        plan_id: replacementPlanId,
        status: 'active',
        trial_start_at: null,
        trial_end_at: null,
        trial_source: 'admin_override',
        updated_at: new Date().toISOString(),
        notes: 'Moved to replacement plan by platform admin before old plan deletion.',
      })
      .eq('plan_id', planId)

    if (syncError) redirect(`/admin/plans?error=${encodeURIComponent(syncError.message)}`)
  }

  const { error } = await supabase.from('billing_plans').delete().eq('id', planId)
  if (error) redirect(`/admin/plans?error=${encodeURIComponent(error.message)}`)

  refreshAdminPaths()
  redirect('/admin/plans?saved=deleted')
}

export async function syncOrganizationSubscriptionAction(formData: FormData) {
  await requirePlatformAdmin()

  const supabase = await createSupabaseServerClient()
  const actorId = await getActorId()
  const organizationId = String(formData.get('organization_id') || '').trim()
  const planId = String(formData.get('plan_id') || '').trim() || null
  const status = normalizeStatus(formData.get('status'))
  const periodDays = toInt(formData.get('period_days'), 30)
  const notes = String(formData.get('notes') || '').trim()

  if (!organizationId) redirect('/admin/plans?error=Organization is required')
  if (!planId && status !== 'canceled' && status !== 'expired') redirect('/admin/plans?error=Choose a plan for active access')

  const now = new Date().toISOString()
  const isClosed = status === 'canceled' || status === 'expired'
  const isTrial = status === 'trialing'
  const endAt = isClosed ? null : getPeriodEnd(periodDays || (isTrial ? 7 : 30))
  const { error } = await supabase.from('organization_subscriptions').upsert({
    organization_id: organizationId,
    plan_id: planId,
    status,
    trial_start_at: isTrial ? now : null,
    trial_end_at: isTrial ? endAt : null,
    current_period_start: isClosed ? null : now,
    current_period_end: endAt,
    trial_source: 'admin_override',
    notes: notes || `Subscription synced by platform admin as ${status}.`,
    manually_granted_by: actorId,
    updated_at: now,
  }, { onConflict: 'organization_id' })

  if (error) redirect(`/admin/plans?error=${encodeURIComponent(error.message)}`)

  refreshAdminPaths()
  redirect('/admin/plans?saved=1#subscriptions')
}

export async function cancelOrganizationSubscriptionAction(formData: FormData) {
  await requirePlatformAdmin()

  const id = String(formData.get('subscription_id') || '').trim()
  if (!id) redirect('/admin/plans?error=Subscription ID is required')

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('organization_subscriptions')
    .update({
      status: 'canceled',
      trial_start_at: null,
      trial_end_at: null,
      current_period_end: new Date().toISOString(),
      notes: 'Canceled by platform admin. If this record has a live Stripe subscription, cancel it in Stripe or the Customer Portal too.',
    })
    .eq('id', id)

  if (error) redirect(`/admin/plans?error=${encodeURIComponent(error.message)}`)

  refreshAdminPaths()
  redirect('/admin/plans?saved=1#subscriptions')
}

export async function deleteOrganizationSubscriptionAction(formData: FormData) {
  await requirePlatformAdmin()

  const id = String(formData.get('subscription_id') || '').trim()
  if (!id) redirect('/admin/plans?error=Subscription ID is required')

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.from('organization_subscriptions').delete().eq('id', id)
  if (error) redirect(`/admin/plans?error=${encodeURIComponent(error.message)}`)

  refreshAdminPaths()
  redirect('/admin/plans?saved=1#subscriptions')
}
