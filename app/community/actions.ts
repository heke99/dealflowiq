'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'

function integerField(formData: FormData, key: string, min: number, max: number) {
  const parsed = Number(String(formData.get(key) || '').trim())
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null
}

async function requireCommunityAdmin() {
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/onboarding?error=WORKSPACE_BOOTSTRAP_FAILED')
  if (!['owner','admin'].includes(workspace.membership?.role || '') && !workspace.access.isPlatformAdmin) redirect('/community?error=WORKSPACE_ACCESS_DENIED')
  return workspace
}

export async function createCommunityTeamAction(formData: FormData) {
  const workspace = await requireCommunityAdmin()
  const name = String(formData.get('name') || '').trim()
  const description = String(formData.get('description') || '').trim()
  if (name.length < 2 || name.length > 120) redirect('/community?error=INVITE_INVALID')
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.from('community_teams').insert({ organization_id: workspace.organization!.id, name, description: description || null, created_by: workspace.user.id })
  if (error) redirect('/community?error=INTERNAL_ERROR')
  revalidatePath('/community')
  redirect('/community?message=TEAM_CREATED')
}

export async function createCommunityInviteAction(formData: FormData) {
  await requireCommunityAdmin()
  const email = String(formData.get('email') || '').trim().toLowerCase()
  const fullName = String(formData.get('full_name') || '').trim()
  const teamId = String(formData.get('team_id') || '').trim() || null
  const role = String(formData.get('role') || 'member')
  const maxUses = integerField(formData, 'max_uses', 1, 500)
  const expiresInDays = integerField(formData, 'expires_in_days', 1, 365)
  const sendEmail = formData.get('send_email') === 'on'
  if (maxUses === null || expiresInDays === null || (sendEmail && !email)) redirect('/community?error=INVITE_INVALID')

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('create_community_invite', {
    _email: email || null,
    _full_name: fullName || null,
    _team_id: teamId,
    _role: role,
    _max_uses: maxUses,
    _expires_in_days: expiresInDays,
    _queue_email: sendEmail,
  })
  if (error || !data) redirect('/community?error=INVITE_ACCEPTANCE_FAILED')

  const result = data as { id: string; invite_code: string; organization_id: string }
  const deliveryStatus = sendEmail ? 'EMAIL_QUEUED' : 'CODE_CREATED'

  revalidatePath('/community')
  redirect(`/community?message=${deliveryStatus}&code=${encodeURIComponent(result.invite_code)}`)
}

export async function revokeCommunityInviteAction(formData: FormData) {
  await requireCommunityAdmin()
  const inviteId = String(formData.get('invite_id') || '').trim()
  if (!inviteId) redirect('/community?error=INVITE_INVALID')
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('revoke_community_invite', { _invite_id: inviteId })
  if (error) redirect('/community?error=INTERNAL_ERROR')
  revalidatePath('/community')
  redirect('/community?message=INVITE_REVOKED')
}
