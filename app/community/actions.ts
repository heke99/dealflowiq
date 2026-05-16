'use server'

import { randomBytes } from 'crypto'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { sendCommunityInviteEmail } from '@/lib/community/inviteEmail'

type InviteRole = 'member' | 'viewer' | 'buyer' | 'acquisition_manager' | 'disposition_manager' | 'admin'

function toMessage(value: string) {
  return encodeURIComponent(value)
}

function normalizeCode(value: FormDataEntryValue | null) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function getBaseUrl() {
  const explicit = process.env.NEXT_PUBLIC_APP_URL
  if (explicit) return explicit.replace(/\/$/, '')
  const vercel = process.env.VERCEL_URL
  if (vercel) return `https://${vercel}`
  return 'http://localhost:3000'
}

function generateInviteCode() {
  return randomBytes(6).toString('hex').toUpperCase()
}

async function requireCommunityAdmin() {
  const workspace = await getCurrentWorkspace()
  const role = workspace.membership?.role
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing workspace')
  if (!['owner', 'admin'].includes(role || '') && !workspace.access.isPlatformAdmin) {
    redirect('/community?error=Only community owners and admins can manage invites')
  }
  return workspace
}

export async function createCommunityTeamAction(formData: FormData) {
  const workspace = await requireCommunityAdmin()
  const supabase = await createSupabaseServerClient()
  const name = String(formData.get('name') || '').trim()
  const description = String(formData.get('description') || '').trim()

  if (name.length < 2) {
    redirect(`/community?error=${toMessage('Team name is required.')}`)
  }

  const { error } = await supabase.from('community_teams').insert({
    organization_id: workspace.organization!.id,
    name,
    description: description || null,
    created_by: workspace.user.id,
  })

  if (error) redirect(`/community?error=${toMessage(error.message)}`)
  revalidatePath('/community')
  redirect('/community?message=Team created')
}

export async function createCommunityInviteAction(formData: FormData) {
  const workspace = await requireCommunityAdmin()
  const supabase = await createSupabaseServerClient()

  const email = String(formData.get('email') || '').trim().toLowerCase()
  const fullName = String(formData.get('full_name') || '').trim()
  const teamId = String(formData.get('team_id') || '').trim() || null
  const roleValue = String(formData.get('role') || 'member') as InviteRole
  const maxUses = Math.max(1, Math.min(500, Number(formData.get('max_uses') || 1)))
  const sendEmail = String(formData.get('send_email') || '') === 'on'
  const expiresInDays = Math.max(1, Math.min(365, Number(formData.get('expires_in_days') || 14)))
  const inviteCode = generateInviteCode()
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()

  if (sendEmail && !email) {
    redirect(`/community?error=${toMessage('Email is required when sending an email invite.')}`)
  }

  const { data: team } = teamId
    ? await supabase.from('community_teams').select('id,name').eq('organization_id', workspace.organization!.id).eq('id', teamId).maybeSingle()
    : { data: null as any }

  const inviteUrl = `${getBaseUrl()}/signup?invite=${encodeURIComponent(inviteCode)}`

  const { data: invite, error } = await supabase
    .from('community_invites')
    .insert({
      organization_id: workspace.organization!.id,
      team_id: teamId,
      created_by: workspace.user.id,
      invite_code: inviteCode,
      email: email || null,
      full_name: fullName || null,
      role: roleValue,
      max_uses: maxUses,
      expires_at: expiresAt,
      metadata: { invite_url: inviteUrl, created_from: 'community_page' },
    })
    .select('id')
    .single()

  if (error) redirect(`/community?error=${toMessage(error.message)}`)

  let deliveryStatus = 'code_created'
  let deliveryError: string | null = null

  if (sendEmail && email) {
    const result = await sendCommunityInviteEmail({
      to: email,
      inviteCode,
      inviteUrl,
      organizationName: workspace.organization!.name,
      teamName: team?.name || null,
      inviterEmail: workspace.user.email,
    })
    deliveryStatus = result.sent ? 'email_sent' : 'email_failed'
    deliveryError = result.error || null

    await supabase
      .from('community_invites')
      .update({ delivery_status: deliveryStatus, delivery_error: deliveryError })
      .eq('id', invite!.id)
      .eq('organization_id', workspace.organization!.id)
  }

  await supabase.from('audit_logs').insert({
    organization_id: workspace.organization!.id,
    actor_id: workspace.user.id,
    event_type: 'community_invite.created',
    entity_type: 'community_invite',
    entity_id: invite!.id,
    metadata: { invite_code: inviteCode, email: email || null, team_id: teamId, delivery_status: deliveryStatus },
  })

  revalidatePath('/community')
  const message = deliveryStatus === 'email_failed'
    ? `Invite code created, but email was not sent: ${deliveryError || 'email provider not configured'}`
    : deliveryStatus === 'email_sent'
      ? 'Invite email sent and invite code created'
      : 'Invite code created'
  redirect(`/community?message=${toMessage(message)}&code=${encodeURIComponent(inviteCode)}`)
}

export async function revokeCommunityInviteAction(formData: FormData) {
  const workspace = await requireCommunityAdmin()
  const supabase = await createSupabaseServerClient()
  const inviteId = String(formData.get('invite_id') || '')

  if (!inviteId) redirect('/community?error=Missing invite id')

  const { error } = await supabase
    .from('community_invites')
    .update({ status: 'revoked' })
    .eq('id', inviteId)
    .eq('organization_id', workspace.organization!.id)

  if (error) redirect(`/community?error=${toMessage(error.message)}`)
  revalidatePath('/community')
  redirect('/community?message=Invite revoked')
}
