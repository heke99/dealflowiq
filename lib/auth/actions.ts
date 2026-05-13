'use server'

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'

function getSafeRedirect(path: FormDataEntryValue | null) {
  const value = typeof path === 'string' ? path : ''
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/dashboard'
  return value
}

function toMessage(value: string) {
  return encodeURIComponent(value)
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

  if (!email || !password) {
    redirect(`/signup?error=${toMessage('Email and password are required.')}`)
  }

  if (password.length < 6) {
    redirect(`/signup?error=${toMessage('Password must be at least 6 characters.')}`)
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName || null,
      },
    },
  })

  if (error) {
    redirect(`/signup?error=${toMessage(error.message)}`)
  }

  if (!data.session) {
    redirect(`/login?message=${toMessage('Account created. Check your email to confirm your account, then log in.')}`)
  }

  redirect('/dashboard')
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut()
  redirect('/login')
}
