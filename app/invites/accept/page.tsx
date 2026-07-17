import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { acceptInviteAction } from '@/app/invites/accept/actions'
import { authErrorMessage } from '@/lib/errors/auth-errors'
import { Turnstile } from '@/components/auth/Turnstile'
import { enforceRateLimit, requestSecurityMetadata } from '@/lib/security/request'

function normalize(value: unknown) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 64)
}

export default async function AcceptInvitePage({ searchParams }: { searchParams?: Promise<{ code?: string }> }) {
  const params = await searchParams
  const code = normalize(params?.code)
  const supabase = await createSupabaseServerClient()
  const admin = createSupabaseAdminClient()
  const request = await requestSecurityMetadata()
  let validationBlocked = false
  try {
    await enforceRateLimit('invite.validate.ip', request.ipHash, 100, 15 * 60)
    await enforceRateLimit('invite.validate', `${request.ipHash}:${code}`, 30, 15 * 60)
  } catch {
    validationBlocked = true
  }
  const [{ data: invite }, { data: auth }] = await Promise.all([
    validationBlocked ? Promise.resolve({ data: { status: 'RATE_LIMITED' } }) : admin.rpc('validate_community_invite', { _invite_code: code }),
    supabase.auth.getUser(),
  ])
  const details = (validationBlocked ? { status: 'RATE_LIMITED' } : (invite || {})) as { status?: string; organization_name?: string; team_name?: string; role?: string; expires_at?: string }
  const active = details.status === 'ACTIVE'
  const next = `/invites/accept?code=${encodeURIComponent(code)}`

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-16 text-white">
      <div className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-white/[0.04] p-8">
        <div className="text-sm font-black uppercase tracking-[0.18em] text-emerald-300">Workspace invite</div>
        <h1 className="mt-3 text-3xl font-black">{active ? `Join ${details.organization_name || 'workspace'}` : 'Invite unavailable'}</h1>
        {active ? (
          <>
            <p className="mt-4 leading-7 text-slate-300">
              You are invited as <strong>{String(details.role || 'member').replaceAll('_', ' ')}</strong>
              {details.team_name ? <> in team <strong>{details.team_name}</strong></> : null}. Acceptance is atomic and can safely be retried.
            </p>
            {auth.user ? (
              <form action={acceptInviteAction} className="mt-7">
                <input type="hidden" name="code" value={code} />
                <Turnstile action="invite_accept" />
                <button className="w-full rounded-2xl bg-white px-5 py-4 font-black text-slate-950 hover:bg-slate-200">Accept invite</button>
              </form>
            ) : (
              <div className="mt-7 grid gap-3 sm:grid-cols-2">
                <Link href={`/signup?invite=${encodeURIComponent(code)}&next=${encodeURIComponent(next)}`} className="rounded-2xl bg-white px-5 py-4 text-center font-black text-slate-950">Create account</Link>
                <Link href={`/login?next=${encodeURIComponent(next)}`} className="rounded-2xl border border-white/10 px-5 py-4 text-center font-black text-white hover:bg-white/10">Log in</Link>
              </div>
            )}
          </>
        ) : (
          <p className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-red-100">{authErrorMessage(details.status || 'INVITE_INVALID')}</p>
        )}
      </div>
    </main>
  )
}
