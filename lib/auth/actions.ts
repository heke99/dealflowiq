'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { ACCOUNT_TYPES, type AccountType } from '@/lib/product/accountTypes'
import { authPath, safeRedirectPath } from '@/lib/auth/redirects'
import { getCanonicalAppUrl } from '@/lib/config/app-url'
import { authErrorCode } from '@/lib/errors/auth-errors'
import { bootstrapCurrentUser } from '@/lib/auth/bootstrap'
import { passwordIsStrong } from '@/lib/auth/password'
import { recordPasswordChangeOrThrow } from '@/lib/auth/password-events'
import { createRecoveryRequestState, verifyRecoverySessionMarker } from '@/lib/auth/recovery-state'
import { enforceRateLimit, requestSecurityMetadata, securityEvent, verifyCaptcha } from '@/lib/security/request'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TERMS_VERSION = process.env.LEGAL_TERMS_VERSION || '2026-07-17'
const PRIVACY_VERSION = process.env.LEGAL_PRIVACY_VERSION || '2026-07-17'

function go(path: string, params: Record<string, string | null | undefined> = {}): never {
  const url = new URL(path, 'https://dealflowiq.invalid')
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value)
  redirect(`${url.pathname}${url.search}`)
}

function normalizeInviteCode(value: FormDataEntryValue | null) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 64)
}

function getAccountType(value: FormDataEntryValue | null): AccountType {
  const stringValue = typeof value === 'string' ? value : ''
  return ACCOUNT_TYPES.includes(stringValue as AccountType) ? stringValue as AccountType : 'solo_investor'
}

function authRedirectUrl(next = '/dashboard', flow?: 'recovery', state?: string) {
  const url = new URL('/auth/callback', getCanonicalAppUrl())
  url.searchParams.set('next', safeRedirectPath(next))
  if (flow) url.searchParams.set('flow', flow)
  if (state) url.searchParams.set('state', state)
  return url.toString()
}

function inviteCodeFromNext(next: string) {
  try {
    const parsed = new URL(next, 'https://dealflowiq.invalid')
    if (parsed.pathname !== '/invites/accept') return ''
    return normalizeInviteCode(parsed.searchParams.get('code'))
  } catch {
    return ''
  }
}

async function guardAuthAttempt(formData: FormData, scope: string, key: string, limit: number) {
  const captcha = String(formData.get('captcha_token') || '')
  const request = await requestSecurityMetadata()
  try {
    await enforceRateLimit(`${scope}.ip`, request.ipHash, Math.max(limit * 4, 20), 15 * 60)
    await enforceRateLimit(scope, `${request.ipHash}:${key}`, limit, 15 * 60)
    if (!(await verifyCaptcha(captcha))) throw new Error('CAPTCHA_FAILED')
  } catch (error) {
    await securityEvent({ eventType: scope, outcome: 'blocked', metadata: { reason: error instanceof Error ? error.message : 'blocked' } })
    throw error
  }
}

export async function signInAction(formData: FormData) {
  const email = String(formData.get('email') || '').trim().toLowerCase()
  const password = String(formData.get('password') || '')
  const next = safeRedirectPath(formData.get('next'))

  if (!EMAIL_RE.test(email) || !password) go('/login', { error: 'INVALID_CREDENTIALS', next })
  try {
    await guardAuthAttempt(formData, 'auth.login', email, 10)
  } catch {
    go('/login', { error: 'RATE_LIMITED', next })
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    const code = authErrorCode(error, 'INVALID_CREDENTIALS')
    await securityEvent({ eventType: 'auth.login', outcome: 'failure', metadata: { code } })
    go('/login', { error: code, next })
  }

  const inviteCode = inviteCodeFromNext(next)
  if (!inviteCode) {
    try {
      await bootstrapCurrentUser()
    } catch {
      await securityEvent({ eventType: 'auth.bootstrap', outcome: 'failure', userId: data.user.id })
      go('/onboarding', { error: 'WORKSPACE_BOOTSTRAP_FAILED' })
    }
  }

  await securityEvent({ eventType: 'auth.login', outcome: 'success', userId: data.user.id })
  redirect(next)
}

export async function signUpAction(formData: FormData) {
  const fullName = String(formData.get('full_name') || '').trim()
  const email = String(formData.get('email') || '').trim().toLowerCase()
  const password = String(formData.get('password') || '')
  const confirmPassword = String(formData.get('confirm_password') || '')
  const accountType = getAccountType(formData.get('account_type'))
  const organizationName = String(formData.get('organization_name') || '').trim()
  const inviteCode = normalizeInviteCode(formData.get('invite_code'))
  const legalAccepted = formData.get('legal_acceptance') === 'on'
  const signupPath = inviteCode ? `/signup?invite=${encodeURIComponent(inviteCode)}` : '/signup'

  if (fullName.length < 2 || fullName.length > 120 || !EMAIL_RE.test(email)) go(signupPath, { error: 'SIGNUP_INVALID' })
  if (!passwordIsStrong(password) || password !== confirmPassword || !legalAccepted) go(signupPath, { error: 'SIGNUP_INVALID' })
  if (!inviteCode && ['community_guru_owner', 'team_company'].includes(accountType) && organizationName.length < 2) go(signupPath, { error: 'SIGNUP_INVALID' })

  try {
    await guardAuthAttempt(formData, 'auth.signup', email, 5)
  } catch {
    go(signupPath, { error: 'RATE_LIMITED' })
  }

  if (inviteCode) {
    try {
      const admin = createSupabaseAdminClient()
      const { data: invite, error } = await admin.from('community_invites')
        .select('email,status,expires_at,accepted_count,max_uses')
        .eq('invite_code', inviteCode).maybeSingle()
      if (error || !invite) go(signupPath, { error: 'INVITE_INVALID' })
      if (invite.status === 'revoked') go(signupPath, { error: 'INVITE_REVOKED' })
      if (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now()) go(signupPath, { error: 'INVITE_EXPIRED' })
      if (invite.status !== 'active' || Number(invite.accepted_count) >= Number(invite.max_uses)) go(signupPath, { error: 'INVITE_ALREADY_USED' })
      if (invite.email && String(invite.email).toLowerCase() !== email) go(signupPath, { error: 'INVITE_EMAIL_MISMATCH' })
    } catch (error) {
      if (error && typeof error === 'object' && 'digest' in error) throw error
      go(signupPath, { error: 'INVITE_ACCEPTANCE_FAILED' })
    }
  }

  const supabase = await createSupabaseServerClient()
  const nextAfterConfirm = inviteCode ? `/invites/accept?code=${encodeURIComponent(inviteCode)}` : '/onboarding'
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: authRedirectUrl(nextAfterConfirm),
      data: { full_name: fullName },
    },
  })

  if (error || !data.user) {
    await securityEvent({ eventType: 'auth.signup', outcome: 'failure', metadata: { code: authErrorCode(error, 'SIGNUP_FAILED') } })
    go(signupPath, { error: 'SIGNUP_FAILED' })
  }

  // Supabase may return an obfuscated user for an existing email. Never use that
  // response for privileged profile writes or deletion.
  if (!data.user.identities?.length) {
    redirect(authPath('/login', nextAfterConfirm, { message: 'CONFIRM_EMAIL' }))
  }

  const request = await requestSecurityMetadata()
  const admin = createSupabaseAdminClient()
  const { data: profileIntent, error: profileIntentError } = await admin.from('profiles').update({
    full_name: fullName,
    account_type: accountType,
    organization_name: organizationName || null,
    pending_invite_code: inviteCode || null,
    onboarding_completed: false,
    onboarding_completed_at: null,
    onboarding_skipped_at: null,
  }).eq('id', data.user.id).select('id').single()

  if (profileIntentError || !profileIntent) {
    await admin.auth.admin.deleteUser(data.user.id)
    go(signupPath, { error: 'SIGNUP_FAILED' })
  }

  const { error: legalError } = await admin.from('legal_acceptances').upsert([
    { user_id: data.user.id, document_type: 'terms', document_version: TERMS_VERSION, ip_hash: request.ipHash, user_agent_hash: request.userAgentHash },
    { user_id: data.user.id, document_type: 'privacy', document_version: PRIVACY_VERSION, ip_hash: request.ipHash, user_agent_hash: request.userAgentHash },
  ], { onConflict: 'user_id,document_type,document_version' })

  if (legalError) {
    await admin.auth.admin.deleteUser(data.user.id)
    go(signupPath, { error: 'SIGNUP_FAILED' })
  }

  await securityEvent({ eventType: 'auth.signup', outcome: 'success', userId: data.user.id })
  if (!data.session) {
    const loginDestination = inviteCode ? '/invites/result?status=ACCEPTED' : nextAfterConfirm
    redirect(authPath('/login', loginDestination, { message: 'CONFIRM_EMAIL' }))
  }

  try {
    await bootstrapCurrentUser(inviteCode || null)
  } catch {
    go('/onboarding', { error: 'WORKSPACE_BOOTSTRAP_FAILED' })
  }
  redirect(inviteCode ? '/invites/result?status=ACCEPTED' : '/onboarding')
}

export async function resendConfirmationEmailAction(formData: FormData) {
  const email = String(formData.get('email') || '').trim().toLowerCase()
  const next = safeRedirectPath(formData.get('next'), '/onboarding')
  if (EMAIL_RE.test(email)) {
    try {
      await guardAuthAttempt(formData, 'auth.resend_confirmation', email, 3)
      const supabase = await createSupabaseServerClient()
      await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: authRedirectUrl(next) } })
    } catch {
      // Generic response prevents account enumeration.
    }
  }
  go('/login', { message: 'CONFIRMATION_SENT', next })
}

export async function requestPasswordResetAction(formData: FormData) {
  const email = String(formData.get('email') || '').trim().toLowerCase()
  if (EMAIL_RE.test(email)) {
    try {
      await guardAuthAttempt(formData, 'auth.password_reset_request', email, 4)
      const supabase = await createSupabaseServerClient()
      const state = createRecoveryRequestState(email)
      await supabase.auth.resetPasswordForEmail(email, { redirectTo: authRedirectUrl('/reset-password', 'recovery', state) })
    } catch {
      // Always return the same user-facing result.
    }
  }
  go('/forgot-password', { message: 'PASSWORD_RESET_SENT' })
}

export async function updatePasswordAction(formData: FormData) {
  const password = String(formData.get('password') || '')
  const confirmPassword = String(formData.get('confirm_password') || '')
  const cookieStore = await cookies()
  if (!cookieStore.get('dfiq-recovery')?.value) go('/forgot-password', { error: 'PASSWORD_RESET_INVALID' })
  if (!passwordIsStrong(password) || password !== confirmPassword) go('/reset-password', { error: 'PASSWORD_RESET_INVALID' })

  const supabase = await createSupabaseServerClient()
  const { data: auth } = await supabase.auth.getUser()
  const user = auth.user
  if (!user?.id || !verifyRecoverySessionMarker(cookieStore.get('dfiq-recovery')?.value, user.id)) {
    cookieStore.delete('dfiq-recovery')
    go('/forgot-password', { error: 'PASSWORD_RESET_INVALID' })
  }
  const { error } = await supabase.auth.updateUser({ password })
  if (error) go('/reset-password', { error: 'PASSWORD_UPDATE_FAILED' })

  let eventWriteFailed = false
  try {
    await recordPasswordChangeOrThrow()
  } catch (eventError) {
    eventWriteFailed = true
    console.error('[password-recovery] event/outbox write failed', eventError)
  }
  await supabase.auth.signOut({ scope: 'others' })
  cookieStore.delete('dfiq-recovery')
  await supabase.auth.signOut()
  go('/login', { message: eventWriteFailed ? 'PASSWORD_UPDATED_AUDIT_PENDING' : 'PASSWORD_UPDATED' })
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut()
  redirect('/login')
}
