import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { safeRedirectPath } from '@/lib/auth/redirects'
import { createRecoverySessionMarker, verifyRecoveryRequestState } from '@/lib/auth/recovery-state'

function inviteFromPath(path: string) {
  try {
    const parsed = new URL(path, 'https://dealflowiq.invalid')
    if (parsed.pathname !== '/invites/accept') return null
    return parsed.searchParams.get('code')
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = safeRedirectPath(url.searchParams.get('next'), '/onboarding')
  const recovery = url.searchParams.get('flow') === 'recovery'
  const recoveryState = url.searchParams.get('state')

  if (url.searchParams.get('error') || url.searchParams.get('error_description') || !code) {
    return NextResponse.redirect(new URL('/login?error=INVALID_AUTH_CALLBACK', url.origin))
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) return NextResponse.redirect(new URL('/login?error=INVALID_AUTH_CALLBACK', url.origin))

  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user?.id || !auth.user.email) {
    await supabase.auth.signOut()
    return NextResponse.redirect(new URL('/login?error=INVALID_AUTH_CALLBACK', url.origin))
  }
  if (recovery && !verifyRecoveryRequestState(recoveryState, auth.user.email)) {
    await supabase.auth.signOut()
    return NextResponse.redirect(new URL('/forgot-password?error=PASSWORD_RESET_INVALID', url.origin))
  }

  const inviteCode = inviteFromPath(next)
  if (!recovery) {
    const { error: bootstrapError } = await supabase.rpc('bootstrap_current_user', { _invite_code: inviteCode })
    if (bootstrapError) return NextResponse.redirect(new URL('/onboarding?error=WORKSPACE_BOOTSTRAP_FAILED', url.origin))
  }

  const destination = recovery ? '/reset-password' : inviteCode ? '/invites/result?status=ACCEPTED' : next
  const response = NextResponse.redirect(new URL(destination, url.origin))
  if (recovery) {
    response.cookies.set('dfiq-recovery', createRecoverySessionMarker(auth.user.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 15 * 60,
    })
  }
  return response
}
