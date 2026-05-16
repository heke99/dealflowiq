'use server'

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { ACCOUNT_TYPES, type AccountType } from '@/lib/product/accountTypes'

function getSafeRedirect(path: FormDataEntryValue | null) {
  const value = typeof path === 'string' ? path : ''
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/dashboard'
  return value
}

function toMessage(value: string) {
  return encodeURIComponent(value)
}

function normalizeInviteCode(value: FormDataEntryValue | null) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function getAccountType(value: FormDataEntryValue | null): AccountType {
  const stringValue = typeof value === 'string' ? value : ''
  if (ACCOUNT_TYPES.includes(stringValue as AccountType)) return stringValue as AccountType
  return 'solo_investor'
}

export async function signInAction(formData: FormData) {
  const email = String(formData.get('email') || '').trim().toLowerCase()
  const password = String(formData.get('password') || '')
  const next = getSafeRedirect(formData.get('next'))

  if (!email || !password) {
    redirect(`/login?error=${toMessage('Email and password are required.')}`)
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    redirect(`/login?error=${toMessage(error.message)}`)
  }

  const inviteFromNext = (() => {
    try {
      const parsed = new URL(next, 'http://dealflowiq.local')
      return normalizeInviteCode(parsed.searchParams.get('invite'))
    } catch {
      return ''
    }
  })()

  if (inviteFromNext) {
    const { error: inviteError } = await supabase.rpc('accept_community_invite', { _invite_code: inviteFromNext })
    if (inviteError) {
      redirect(`/login?error=${toMessage(inviteError.message)}`)
    }
  }

  redirect(next)
}

export async function signUpAction(formData: FormData) {
  const fullName = String(formData.get('full_name') || '').trim()
  const email = String(formData.get('email') || '').trim().toLowerCase()
  const password = String(formData.get('password') || '')
  const accountType = getAccountType(formData.get('account_type'))
  const organizationName = String(formData.get('organization_name') || '').trim()
  const inviteCode = normalizeInviteCode(formData.get('invite_code'))

  if (!email || !password) {
    redirect(`/signup?error=${toMessage('Email and password are required.')}`)
  }

  if (password.length < 6) {
    redirect(`/signup?error=${toMessage('Password must be at least 6 characters.')}`)
  }

  if (!inviteCode && (accountType === 'community_guru_owner' || accountType === 'team_company') && organizationName.length < 2) {
    redirect(`/signup?error=${toMessage('Workspace name is required for community and team accounts.')}`)
  }

  if (inviteCode) {
    let inviteErrorMessage: string | null = null
    try {
      const admin = createSupabaseAdminClient()
      const { data: invite, error: inviteError } = await admin
        .from('community_invites')
        .select('id,email,status,expires_at,accepted_count,max_uses')
        .eq('invite_code', inviteCode)
        .maybeSingle()

      if (inviteError) throw inviteError
      if (!invite) inviteErrorMessage = 'Invite code was not found.'
      else if (invite.status !== 'active') inviteErrorMessage = 'Invite code is no longer active.'
      else if (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now()) inviteErrorMessage = 'Invite code has expired.'
      else if (Number(invite.accepted_count || 0) >= Number(invite.max_uses || 1)) inviteErrorMessage = 'Invite code has already been used.'
      else if (invite.email && String(invite.email).toLowerCase() !== email) inviteErrorMessage = 'This invite is assigned to a different email address.'
    } catch (error) {
      inviteErrorMessage = error instanceof Error ? error.message : 'Could not validate invite code.'
    }
    if (inviteErrorMessage) {
      redirect(`/signup?invite=${encodeURIComponent(inviteCode)}&error=${toMessage(inviteErrorMessage)}`)
    }
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName || null,
        account_type: accountType,
        organization_name: organizationName || null,
        invite_code: inviteCode || null,
      },
    },
  })

  if (error) {
    redirect(`/signup?error=${toMessage(error.message)}`)
  }

  if (!data.session) {
    const next = inviteCode ? `/dashboard?invite=${encodeURIComponent(inviteCode)}` : '/dashboard'
    redirect(`/login?next=${encodeURIComponent(next)}&message=${toMessage(inviteCode ? 'Account created. Confirm your email, then log in to join the community.' : 'Account created. Check your email to confirm your account, then log in.')}`)
  }

  if (inviteCode) {
    const { error: inviteAcceptError } = await supabase.rpc('accept_community_invite', { _invite_code: inviteCode })
    if (inviteAcceptError) {
      redirect(`/signup?invite=${encodeURIComponent(inviteCode)}&error=${toMessage(inviteAcceptError.message)}`)
    }
    redirect('/dashboard')
  }

  const { error: workspaceError } = await supabase.rpc('create_default_organization')
  if (workspaceError) {
    redirect(`/dashboard?error=${toMessage(workspaceError.message)}`)
  }

  redirect('/dashboard')
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut()
  redirect('/login')
}
