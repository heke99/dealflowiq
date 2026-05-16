'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePlatformAdmin } from '@/lib/auth/admin'
import { FEATURE_KEYS, type FeatureMap } from '@/lib/billing/features'
import { ACCOUNT_TYPES } from '@/lib/product/accountTypes'

const SUBSCRIPTION_STATUSES = new Set(['active', 'past_due', 'canceled', 'expired', 'comped', 'manually_granted'])

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
  revalidatePath('/settings/billing')
  revalidatePath('/dashboard')
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
  const isPublic = formData.get('is_public') === 'on'
  const isActive = formData.get('is_active') === 'on'
  const accountTypes = parseAccountTypes(formData)
  const features = parseFeatures(formData)
  const limits = parseLimits(formData)

  if (!name || !code) {
    redirect('/admin/plans?error=Plan name and code are required')
  }

  const payload = {
    name,
    code,
    description: description || null,
    currency,
    monthly_price_cents: monthlyPriceCents,
    annual_price_cents: annualPriceCents,
    trial_days: 0,
    display_order: displayOrder,
    is_public: isPublic,
    is_active: isActive,
    account_types: accountTypes,
    features,
    limits,
    updated_by: actorId,
    ...(id ? {} : { created_by: actorId }),
  }

  const response = id
    ? await supabase.from('billing_plans').update(payload).eq('id', id)
    : await supabase.from('billing_plans').insert(payload)

  if (response.error) {
    redirect(`/admin/plans?error=${encodeURIComponent(response.error.message)}`)
  }

  refreshAdminPaths()
  redirect('/admin/plans?saved=1')
}

export async function deletePlanAction(formData: FormData) {
  await requirePlatformAdmin()

  const planId = String(formData.get('plan_id') || '').trim()
  const replacementPlanId = String(formData.get('replacement_plan_id') || '').trim() || null
  if (!planId) redirect('/admin/plans?error=Plan ID is required')
  if (replacementPlanId === planId) redirect('/admin/plans?error=Replacement plan must be different')

  const supabase = await createSupabaseServerClient()
  const { count, error: countError } = await supabase
    .from('organization_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('plan_id', planId)

  if (countError) redirect(`/admin/plans?error=${encodeURIComponent(countError.message)}`)

  if ((count || 0) > 0 && !replacementPlanId) {
    redirect('/admin/plans?error=This plan is assigned to organizations. Choose a replacement plan before deleting it.')
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
      })
      .eq('plan_id', planId)

    if (syncError) redirect(`/admin/plans?error=${encodeURIComponent(syncError.message)}`)
  }

  const { error } = await supabase.from('billing_plans').delete().eq('id', planId)
  if (error) redirect(`/admin/plans?error=${encodeURIComponent(error.message)}`)

  refreshAdminPaths()
  redirect('/admin/plans?saved=1')
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
  const { error } = await supabase.from('organization_subscriptions').upsert({
    organization_id: organizationId,
    plan_id: planId,
    status,
    trial_start_at: null,
    trial_end_at: null,
    current_period_start: status === 'canceled' || status === 'expired' ? null : now,
    current_period_end: status === 'canceled' || status === 'expired' ? null : getPeriodEnd(periodDays),
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
      notes: 'Canceled by platform admin.',
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
