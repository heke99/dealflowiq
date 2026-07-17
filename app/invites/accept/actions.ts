'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { authErrorCode } from '@/lib/errors/auth-errors'
import { enforceRateLimit, requestSecurityMetadata, securityEvent, verifyCaptcha } from '@/lib/security/request'

function code(value: FormDataEntryValue | null) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 64)
}

export async function acceptInviteAction(formData: FormData) {
  const inviteCode = code(formData.get('code'))
  if (!inviteCode) redirect('/invites/result?status=INVITE_INVALID')
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(`/invites/accept?code=${inviteCode}`)}`)

  const request = await requestSecurityMetadata()
  try {
    await enforceRateLimit('invite.accept.ip', request.ipHash, 40, 15 * 60)
    await enforceRateLimit('invite.accept.user', `${request.ipHash}:${user.id}`, 20, 15 * 60)
    await enforceRateLimit('invite.accept', `${request.ipHash}:${user.id}:${inviteCode}`, 10, 15 * 60)
    if (!(await verifyCaptcha(String(formData.get('captcha_token') || '')))) throw new Error('CAPTCHA_FAILED')
  } catch {
    await securityEvent({ eventType: 'invite.accept', outcome: 'blocked', userId: user.id })
    redirect('/invites/result?status=RATE_LIMITED')
  }

  const { error } = await supabase.rpc('accept_community_invite', { _invite_code: inviteCode })
  if (error) {
    await securityEvent({ eventType: 'invite.accept', outcome: 'failure', userId: user.id, metadata: { code: authErrorCode(error, 'INVITE_ACCEPTANCE_FAILED') } })
    redirect(`/invites/result?status=${authErrorCode(error, 'INVITE_ACCEPTANCE_FAILED')}`)
  }
  await securityEvent({ eventType: 'invite.accept', outcome: 'success', userId: user.id })
  revalidatePath('/', 'layout')
  redirect('/invites/result?status=ACCEPTED')
}
