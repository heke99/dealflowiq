import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { safeRedirectPath } from '@/lib/auth/redirects'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) return supabaseResponse

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        supabaseResponse = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options))
      },
    },
  })

  const { data: { user } } = await supabase.auth.getUser()
  const pathname = request.nextUrl.pathname
  const protectedPrefixes = ['/dashboard','/onboarding','/deals','/buyers','/settings','/admin','/market','/imports','/opportunities','/buy-boxes','/saved-deals','/rent-analysis','/calculators','/community','/messages','/notifications','/invites/result']
  const isProtected = protectedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))

  if (isProtected && !user) {
    const url = request.nextUrl.clone()
    const returnPath = `${request.nextUrl.pathname}${request.nextUrl.search}`
    url.pathname = '/login'
    url.search = ''
    url.searchParams.set('next', returnPath)
    return NextResponse.redirect(url)
  }

  if (user && (pathname === '/login' || pathname === '/signup')) {
    const next = safeRedirectPath(request.nextUrl.searchParams.get('next'))
    return NextResponse.redirect(new URL(next, request.url))
  }

  const onboardingExempt = pathname === '/onboarding'
    || pathname.startsWith('/onboarding/')
    || pathname === '/invites/accept'
    || pathname.startsWith('/invites/accept/')
    || pathname === '/invites/result'
    || pathname.startsWith('/invites/result/')

  if (user && isProtected && !onboardingExempt) {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('onboarding_completed,active_organization_id')
      .eq('id', user.id)
      .maybeSingle()

    let workspaceUnavailable = false
    if (!profileError && profile?.onboarding_completed === true) {
      if (!profile.active_organization_id) {
        workspaceUnavailable = true
      } else {
        const { data: membership, error: membershipError } = await supabase
          .from('organization_members')
          .select('id')
          .eq('organization_id', profile.active_organization_id)
          .eq('user_id', user.id)
          .eq('status', 'active')
          .maybeSingle()
        workspaceUnavailable = Boolean(membershipError || !membership)
      }
    }

    if (profileError || !profile || profile.onboarding_completed !== true || workspaceUnavailable) {
      const url = request.nextUrl.clone()
      const returnPath = `${request.nextUrl.pathname}${request.nextUrl.search}`
      url.pathname = '/onboarding'
      url.search = ''
      url.searchParams.set('next', returnPath)
      if (profileError || !profile) url.searchParams.set('error', 'PROFILE_UNAVAILABLE')
      else if (workspaceUnavailable) url.searchParams.set('error', 'WORKSPACE_BOOTSTRAP_FAILED')
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}
