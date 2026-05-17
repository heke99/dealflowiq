import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const allowedOtpTypes = new Set(['signup', 'invite', 'magiclink', 'recovery', 'email', 'email_change'])

function safeNext(value: string | null, type: string) {
  const fallback = type === 'recovery' ? '/reset-password' : '/dashboard'
  if (!value || !value.startsWith('/') || value.startsWith('//')) return fallback
  return value
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const tokenHash = url.searchParams.get('token_hash')
  const rawType = url.searchParams.get('type') || 'email'
  const type = allowedOtpTypes.has(rawType) ? rawType : 'email'
  const next = safeNext(url.searchParams.get('next'), type)
  const errorDescription = url.searchParams.get('error_description') || url.searchParams.get('error')

  if (errorDescription) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(errorDescription)}`, url.origin))
  }

  const supabase = await createSupabaseServerClient()

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin))
    }
    return NextResponse.redirect(new URL(next, url.origin))
  }

  if (!tokenHash) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent('Missing confirmation token.')}`, url.origin))
  }

  const { error } = await supabase.auth.verifyOtp({
    type: type as any,
    token_hash: tokenHash,
  })

  if (error) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin))
  }

  return NextResponse.redirect(new URL(next, url.origin))
}
