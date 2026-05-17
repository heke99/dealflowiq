'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requirePlatformAdmin } from '@/lib/auth/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ACCOUNT_TYPES, type AccountType } from '@/lib/product/accountTypes'
import { FEATURE_KEYS, type FeatureMap } from '@/lib/billing/features'

const VALID_ROLES = new Set(['owner', 'admin', 'acquisition_manager', 'disposition_manager', 'member', 'buyer', 'viewer'])

function toInt(value: FormDataEntryValue | null, fallback = 0) {
  const parsed = Number(String(value || '').trim())
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback
}

function getAccountType(value: FormDataEntryValue | null): AccountType {
  const stringValue = String(value || '')
  return ACCOUNT_TYPES.includes(stringValue as AccountType) ? stringValue as AccountType : 'solo_investor'
}

function getRole(value: FormDataEntryValue | null) {
  const stringValue = String(value || 'owner')
  return VALID_ROLES.has(stringValue) ? stringValue : 'owner'
}

function parseFeatures(formData: FormData): FeatureMap {
  return FEATURE_KEYS.reduce<FeatureMap>((acc, feature) => {
    if (formData.get(`feature_${feature}`) === 'on') acc[feature] = true
    return acc
  }, {})
}

function parseLimits(formData: FormData) {
  const limits: Record<string, number> = {}
  for (const key of ['max_deals', 'max_buyers', 'max_team_members', 'max_hud_lookups', 'max_ai_reviews', 'max_deal_landing_pages', 'max_community_members']) {
    const raw = String(formData.get(key) || '').trim()
    if (raw) limits[key] = toInt(formData.get(key), 0)
  }
  return limits
}

export async function createAdminAccessInviteAction(formData: FormData) {
  await requirePlatformAdmin()

  const email = String(formData.get('email') || '').trim().toLowerCase()
  const organizationName = String(formData.get('organization_name') || '').trim()
  const accountType = getAccountType(formData.get('account_type'))
  const role = getRole(formData.get('role'))
  const planId = String(formData.get('plan_id') || '').trim() || null
  const trialDays = toInt(formData.get('trial_days'), 0)
  const expiresInDays = toInt(formData.get('expires_in_days'), 30)
  const notes = String(formData.get('notes') || '').trim()
  const featuresOverride = parseFeatures(formData)
  const limitsOverride = parseLimits(formData)

  if (!email || !email.includes('@')) {
    redirect('/admin/access?error=Valid email is required')
  }

  const supabase = await createSupabaseServerClient()
  const { data: userData } = await supabase.auth.getUser()
  const createdBy = userData.user?.id || null

  const { error } = await supabase.from('admin_access_invites').insert({
    email,
    organization_name: organizationName || null,
    account_type: accountType,
    role,
    plan_id: planId,
    trial_days: trialDays,
    expires_at: expiresInDays > 0 ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString() : null,
    features_override: featuresOverride,
    limits_override: limitsOverride,
    notes: notes || null,
    created_by: createdBy,
  })

  if (error) redirect(`/admin/access?error=${encodeURIComponent(error.message)}`)

  revalidatePath('/admin/access')
  redirect('/admin/access?saved=1')
}

export async function revokeAdminAccessInviteAction(formData: FormData) {
  await requirePlatformAdmin()
  const id = String(formData.get('id') || '').trim()
  if (!id) redirect('/admin/access?error=Invite ID is required')

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.from('admin_access_invites').update({ status: 'revoked' }).eq('id', id)
  if (error) redirect(`/admin/access?error=${encodeURIComponent(error.message)}`)

  revalidatePath('/admin/access')
  redirect('/admin/access?saved=1')
}

export async function grantMemberFullAccessOverrideAction(formData: FormData) {
  await requirePlatformAdmin()

  const organizationId = String(formData.get('organization_id') || '').trim()
  const userId = String(formData.get('user_id') || '').trim()
  const expiresInDays = toInt(formData.get('expires_in_days'), 0)
  const notes = String(formData.get('notes') || '').trim()

  if (!organizationId || !userId) {
    redirect('/admin/access?error=Choose an organization member to override')
  }

  const supabase = await createSupabaseServerClient()
  const { data: userData } = await supabase.auth.getUser()
  const grantedBy = userData.user?.id || null
  const now = new Date().toISOString()
  const expiresAt = expiresInDays > 0 ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString() : null

  const { error } = await supabase.from('member_access_overrides').upsert({
    organization_id: organizationId,
    user_id: userId,
    status: 'full_access',
    starts_at: now,
    expires_at: expiresAt,
    features_override: {},
    limits_override: { unlimited: null },
    notes: notes || 'Full access granted by platform admin.',
    granted_by: grantedBy,
    updated_at: now,
  }, { onConflict: 'organization_id,user_id' })

  if (error) redirect(`/admin/access?error=${encodeURIComponent(error.message)}`)

  revalidatePath('/admin/access')
  revalidatePath('/admin')
  revalidatePath('/dashboard')
  redirect('/admin/access?saved=1#member-overrides')
}

export async function revokeMemberAccessOverrideAction(formData: FormData) {
  await requirePlatformAdmin()

  const id = String(formData.get('id') || '').trim()
  if (!id) redirect('/admin/access?error=Override ID is required')

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('member_access_overrides')
    .update({ status: 'revoked', updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) redirect(`/admin/access?error=${encodeURIComponent(error.message)}`)

  revalidatePath('/admin/access')
  revalidatePath('/admin')
  revalidatePath('/dashboard')
  redirect('/admin/access?saved=1#member-overrides')
}
