import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { safeRedirectPath } from '@/lib/auth/redirects'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = safeRedirectPath(url.searchParams.get('next'))
  const errorDescription = url.searchParams.get('error_description') || url.searchParams.get('error')

  if (errorDescription) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(errorDescription)}`, url.origin))
  }

  if (!code) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent('Missing auth callback code.')}`, url.origin))
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin))
  }

  return NextResponse.redirect(new URL(next, url.origin))
}
