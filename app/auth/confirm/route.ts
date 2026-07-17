import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { safeRedirectPath } from '@/lib/auth/redirects'
import { createRecoverySessionMarker, verifyRecoveryRequestState } from '@/lib/auth/recovery-state'

function inviteFromPath(path: string) {
  try {
    const parsed = new URL(path, 'https://dealflowiq.invalid')
    return parsed.pathname === '/invites/accept' ? parsed.searchParams.get('code') : null
  } catch {
    return null
  }
}

const allowedOtpTypes = new Set<EmailOtpType>(['signup', 'invite', 'magiclink', 'recovery', 'email', 'email_change'])

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const tokenHash = url.searchParams.get('token_hash')
  const rawType = url.searchParams.get('type') || 'email'
  const type = allowedOtpTypes.has(rawType as EmailOtpType) ? rawType as EmailOtpType : 'email'
  const recovery = type === 'recovery'
  const recoveryState = url.searchParams.get('state')
  const next = safeRedirectPath(url.searchParams.get('next'), recovery ? '/reset-password' : '/onboarding')

  if (url.searchParams.get('error') || url.searchParams.get('error_description')) {
    return NextResponse.redirect(new URL('/login?error=INVALID_AUTH_CALLBACK', url.origin))
  }

  const supabase = await createSupabaseServerClient()
  const result = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash
      ? await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
      : { error: new Error('missing token') }

  if (result.error) return NextResponse.redirect(new URL('/login?error=INVALID_AUTH_CALLBACK', url.origin))
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user?.id || !auth.user.email) {
    await supabase.auth.signOut()
    return NextResponse.redirect(new URL('/login?error=INVALID_AUTH_CALLBACK', url.origin))
  }

  if (recovery && code && !verifyRecoveryRequestState(recoveryState, auth.user.email)) {
    await supabase.auth.signOut()
    return NextResponse.redirect(new URL('/forgot-password?error=PASSWORD_RESET_INVALID', url.origin))
  }

  const inviteCode = inviteFromPath(next)
  if (!recovery) {
    const { error } = await supabase.rpc('bootstrap_current_user', { _invite_code: inviteCode })
    if (error) return NextResponse.redirect(new URL('/onboarding?error=WORKSPACE_BOOTSTRAP_FAILED', url.origin))
  }

  const destination = recovery ? '/reset-password' : inviteCode ? '/invites/result?status=ACCEPTED' : next
  const response = NextResponse.redirect(new URL(destination, url.origin))
  if (recovery) response.cookies.set('dfiq-recovery', createRecoverySessionMarker(auth.user.id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 15 * 60,
  })
  return response
}
