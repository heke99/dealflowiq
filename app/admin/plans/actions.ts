'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePlatformAdmin } from '@/lib/auth/admin'
import { FEATURE_KEYS, type FeatureMap } from '@/lib/billing/features'
import { ACCOUNT_TYPES } from '@/lib/product/accountTypes'

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

export async function savePlanAction(formData: FormData) {
  await requirePlatformAdmin()

  const supabase = await createSupabaseServerClient()
  const id = String(formData.get('id') || '').trim()
  const name = String(formData.get('name') || '').trim()
  const code = normalizeCode(String(formData.get('code') || name))
  const description = String(formData.get('description') || '').trim()
  const currency = String(formData.get('currency') || 'usd').trim().toLowerCase()
  const monthlyPriceCents = toCents(formData.get('monthly_price'))
  const annualPriceCents = toCents(formData.get('annual_price'))
  const trialDays = toInt(formData.get('trial_days'), 7)
  const displayOrder = toInt(formData.get('display_order'), 100)
  const isPublic = formData.get('is_public') === 'on'
  const isActive = formData.get('is_active') === 'on'
  const accountTypes = parseAccountTypes(formData)
  const features = parseFeatures(formData)
  const limits = {
    max_deals: toInt(formData.get('max_deals'), 25),
    max_buyers: toInt(formData.get('max_buyers'), 0),
    max_team_members: toInt(formData.get('max_team_members'), 1),
    max_hud_lookups: toInt(formData.get('max_hud_lookups'), 100),
    max_ai_reviews: toInt(formData.get('max_ai_reviews'), 0),
    max_deal_landing_pages: toInt(formData.get('max_deal_landing_pages'), 5),
    max_community_members: toInt(formData.get('max_community_members'), 0),
  }

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
    trial_days: trialDays,
    display_order: displayOrder,
    is_public: isPublic,
    is_active: isActive,
    account_types: accountTypes,
    features,
    limits,
  }

  const response = id
    ? await supabase.from('billing_plans').update(payload).eq('id', id)
    : await supabase.from('billing_plans').insert(payload)

  if (response.error) {
    redirect(`/admin/plans?error=${encodeURIComponent(response.error.message)}`)
  }

  revalidatePath('/admin/plans')
  revalidatePath('/settings/billing')
  redirect('/admin/plans?saved=1')
}

export async function extendTrialAction(formData: FormData) {
  await requirePlatformAdmin()

  const organizationId = String(formData.get('organization_id') || '').trim()
  const extraDays = toInt(formData.get('extra_days'), 7)
  const note = String(formData.get('note') || '').trim()

  if (!organizationId) redirect('/admin/plans?error=Organization ID is required')

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('organization_subscriptions')
    .update({
      status: 'trialing',
      trial_source: 'admin_override',
      trial_end_at: new Date(Date.now() + extraDays * 24 * 60 * 60 * 1000).toISOString(),
      notes: note || `Trial extended by ${extraDays} days.`,
    })
    .eq('organization_id', organizationId)

  if (error) redirect(`/admin/plans?error=${encodeURIComponent(error.message)}`)

  revalidatePath('/admin/plans')
  redirect('/admin/plans?saved=1')
}
