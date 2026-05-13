'use server'

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ACCOUNT_TYPES, type AccountType } from '@/lib/product/accountTypes'

function getSafeRedirect(path: FormDataEntryValue | null) {
  const value = typeof path === 'string' ? path : ''
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/dashboard'
  return value
}

function toMessage(value: string) {
  return encodeURIComponent(value)
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

  redirect(next)
}

export async function signUpAction(formData: FormData) {
  const fullName = String(formData.get('full_name') || '').trim()
  const email = String(formData.get('email') || '').trim().toLowerCase()
  const password = String(formData.get('password') || '')
  const accountType = getAccountType(formData.get('account_type'))
  const organizationName = String(formData.get('organization_name') || '').trim()

  if (!email || !password) {
    redirect(`/signup?error=${toMessage('Email and password are required.')}`)
  }

  if (password.length < 6) {
    redirect(`/signup?error=${toMessage('Password must be at least 6 characters.')}`)
  }

  if ((accountType === 'community_guru_owner' || accountType === 'team_company') && organizationName.length < 2) {
    redirect(`/signup?error=${toMessage('Workspace name is required for community and team accounts.')}`)
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
      },
    },
  })

  if (error) {
    redirect(`/signup?error=${toMessage(error.message)}`)
  }

  if (!data.session) {
    redirect(`/login?message=${toMessage('Account created. Check your email to confirm your account, then log in.')}`)
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
