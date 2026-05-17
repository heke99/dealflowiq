'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requirePlatformAdmin } from '@/lib/auth/admin'
import { requireUser } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'

function text(formData: FormData, key: string) {
  const value = String(formData.get(key) || '').trim()
  return value || null
}

export async function grantUserFullAccessOverrideAction(formData: FormData) {
  await requirePlatformAdmin()
  const actor = await requireUser()
  const supabase = await createSupabaseServerClient()
  const userId = text(formData, 'user_id')
  const organizationId = text(formData, 'organization_id')
  const reason = text(formData, 'reason') || 'Manual full access override from super admin.'
  const expiresAtRaw = text(formData, 'expires_at')
  if (!userId) redirect('/admin/users?error=Missing user id')

  await supabase.from('user_access_overrides').insert({
    user_id: userId,
    organization_id: organizationId,
    status: 'active',
    reason,
    created_by: actor.id,
    expires_at: expiresAtRaw ? new Date(expiresAtRaw).toISOString() : null,
    features_override: {},
    limits_override: { max_visible_opportunities: null, opportunity_detail_cooldown_hours: 0, max_imports_per_7_days: null },
  })

  revalidatePath('/admin/users')
  redirect('/admin/users?saved=override')
}

export async function revokeUserAccessOverrideAction(formData: FormData) {
  await requirePlatformAdmin()
  const actor = await requireUser()
  const supabase = await createSupabaseServerClient()
  const id = text(formData, 'override_id')
  if (!id) redirect('/admin/users?error=Missing override id')

  await supabase
    .from('user_access_overrides')
    .update({ status: 'revoked', revoked_by: actor.id, revoked_at: new Date().toISOString() })
    .eq('id', id)

  revalidatePath('/admin/users')
  redirect('/admin/users?saved=revoked')
}
