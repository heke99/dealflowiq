import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { grantUserFullAccessOverrideAction, revokeUserAccessOverrideAction } from '@/app/admin/users/actions'

type Row = Record<string, any>

type AdminUsersPageProps = {
  searchParams?: Promise<{ q?: string; role?: string; access?: string; community?: string; saved?: string; error?: string }> | { q?: string; role?: string; access?: string; community?: string; saved?: string; error?: string }
}

function numberText(value: number | null | undefined) {
  return new Intl.NumberFormat('en-US').format(Number(value || 0))
}

function dateText(value?: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
}

function badge(value: string, tone = 'default') {
  const tones: Record<string, string> = {
    default: 'border-white/10 bg-white/5 text-slate-200',
    green: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100',
    amber: 'border-amber-400/25 bg-amber-400/10 text-amber-100',
    blue: 'border-blue-400/25 bg-blue-400/10 text-blue-100',
    red: 'border-red-400/25 bg-red-400/10 text-red-100',
  }
  return <span className={`rounded-full border px-3 py-1 text-xs font-bold capitalize ${tones[tone] || tones.default}`}>{value.replaceAll('_', ' ')}</span>
}

function accessFor(row: Row, activeOverride: Row | null) {
  const subscription = Array.isArray(row.organization_subscriptions) ? row.organization_subscriptions[0] : row.organization_subscriptions
  const status = String(subscription?.status || 'free')
  const trialEnds = subscription?.trial_end_at ? new Date(subscription.trial_end_at).getTime() : 0
  if (activeOverride) return { label: 'override', tone: 'blue' }
  if (status === 'trialing' && trialEnds > Date.now()) return { label: 'trial', tone: 'amber' }
  if (['active', 'paid', 'comped'].includes(status)) return { label: 'paid', tone: 'green' }
  if (['past_due', 'unpaid', 'incomplete'].includes(status)) return { label: 'payment required', tone: 'red' }
  return { label: 'free', tone: 'default' }
}

export default async function AdminUsersPage({ searchParams }: AdminUsersPageProps) {
  const params = await Promise.resolve(searchParams || {})
  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()

  if (!workspace.access.isPlatformAdmin) {
    return (
      <AppShell organizationName={workspace.organization?.name} userEmail={workspace.user.email} accountType={workspace.access.accountType} features={workspace.access.features} subscriptionStatus={workspace.access.status} planName={workspace.access.plan?.name} trialEndsAt={workspace.access.trialEndsAt} isPlatformAdmin={workspace.access.isPlatformAdmin}>
        <div className="rounded-3xl border border-amber-500/30 bg-amber-500/10 p-8 text-amber-100"><h1 className="text-3xl font-black">Platform admin required</h1><p className="mt-3 text-sm">Only super admins can view all platform users.</p></div>
      </AppShell>
    )
  }

  const q = String(params.q || '').trim()
  const roleFilter = String(params.role || '')
  const accessFilter = String(params.access || '')
  const communityFilter = String(params.community || '')

  const [profilesResult, membersResult, overridesResult, communitiesResult, orgCount, communityCount, activeSubsCount] = await Promise.all([
    supabase.from('profiles').select('id,email,full_name,account_type,organization_name,created_at,onboarding_completed').order('created_at', { ascending: false }).limit(300),
    supabase.from('organization_members').select('id,user_id,role,status,created_at,organizations(id,name,account_type,organization_subscriptions(status,trial_end_at,current_period_end,billing_plans(name,code)))').order('created_at', { ascending: false }).limit(1000),
    supabase.from('user_access_overrides').select('id,user_id,organization_id,status,reason,expires_at,created_at').eq('status', 'active').order('created_at', { ascending: false }).limit(1000),
    supabase.from('community_teams').select('id,name,organization_id,organizations(name)').order('name', { ascending: true }).limit(500),
    supabase.from('organizations').select('id', { count: 'exact', head: true }),
    supabase.from('community_teams').select('id', { count: 'exact', head: true }),
    supabase.from('organization_subscriptions').select('id', { count: 'exact', head: true }).in('status', ['active', 'paid', 'trialing', 'comped']),
  ])

  const profiles = (profilesResult.data || []) as Row[]
  const members = (membersResult.data || []) as Row[]
  const overrides = (overridesResult.data || []) as Row[]
  const communities = (communitiesResult.data || []) as Row[]
  const memberByUser = new Map<string, Row>()
  members.forEach((member) => { if (!memberByUser.has(String(member.user_id))) memberByUser.set(String(member.user_id), member) })
  const overrideByUser = new Map<string, Row>()
  overrides.forEach((override) => { if (!overrideByUser.has(String(override.user_id))) overrideByUser.set(String(override.user_id), override) })

  let rows = profiles.map((profile) => {
    const member = memberByUser.get(String(profile.id)) || null
    const org = Array.isArray(member?.organizations) ? member.organizations[0] : member?.organizations
    const activeOverride = overrideByUser.get(String(profile.id)) || null
    const access = accessFor(org || {}, activeOverride)
    return { profile, member, org, activeOverride, access }
  })

  if (q) {
    const needle = q.toLowerCase()
    rows = rows.filter((row) => [row.profile.email, row.profile.full_name, row.profile.organization_name, row.org?.name].filter(Boolean).join(' ').toLowerCase().includes(needle))
  }
  if (roleFilter) rows = rows.filter((row) => String(row.member?.role || '') === roleFilter)
  if (accessFilter) rows = rows.filter((row) => row.access.label === accessFilter)
  if (communityFilter) {
    const teamMembers = await supabase.from('community_team_members').select('user_id').eq('team_id', communityFilter).limit(1000)
    const allowed = new Set(((teamMembers.data || []) as Row[]).map((row) => String(row.user_id)))
    rows = rows.filter((row) => allowed.has(String(row.profile.id)))
  }

  return (
    <AppShell organizationName={workspace.organization?.name} userEmail={workspace.user.email} accountType={workspace.access.accountType} features={workspace.access.features} subscriptionStatus={workspace.access.status} planName={workspace.access.plan?.name} trialEndsAt={workspace.access.trialEndsAt} isPlatformAdmin={workspace.access.isPlatformAdmin}>
      <div className="space-y-8">
        <section className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-blue-500/15 via-slate-950 to-emerald-500/10 p-6 sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-sm font-black uppercase tracking-wide text-blue-300">Super admin</div>
              <h1 className="mt-3 text-4xl font-black tracking-tight">Users</h1>
              <p className="mt-3 max-w-3xl text-slate-300">Search every user, filter by role/access/community, view organization access and manually give full access override when needed.</p>
            </div>
            <Link href="/admin" className="rounded-2xl border border-white/10 px-5 py-3 text-sm font-bold text-white hover:bg-white/10">Back to dashboard</Link>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5"><div className="text-sm text-slate-400">Users shown</div><div className="mt-3 text-3xl font-black">{numberText(rows.length)}</div></div>
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5"><div className="text-sm text-slate-400">Organizations</div><div className="mt-3 text-3xl font-black">{numberText(orgCount.count)}</div></div>
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5"><div className="text-sm text-slate-400">Communities</div><div className="mt-3 text-3xl font-black">{numberText(communityCount.count)}</div></div>
          <div className="rounded-3xl border border-emerald-400/25 bg-emerald-400/10 p-5"><div className="text-sm text-emerald-100/80">Active/trial access</div><div className="mt-3 text-3xl font-black">{numberText(activeSubsCount.count)}</div></div>
        </section>

        <form className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <div className="grid gap-3 md:grid-cols-[1.3fr_0.7fr_0.7fr_0.9fr_auto]">
            <input name="q" defaultValue={q} placeholder="Search name, email, org..." className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none focus:border-white/30" />
            <select name="role" defaultValue={roleFilter} className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm"><option value="">All roles</option>{['owner','admin','acquisition_manager','disposition_manager','member','buyer','viewer'].map((role) => <option key={role} value={role}>{role.replaceAll('_',' ')}</option>)}</select>
            <select name="access" defaultValue={accessFilter} className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm"><option value="">All access</option>{['free','trial','paid','payment required','override'].map((access) => <option key={access} value={access}>{access}</option>)}</select>
            <select name="community" defaultValue={communityFilter} className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm"><option value="">All communities</option>{communities.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select>
            <button className="rounded-xl bg-white px-5 py-3 text-sm font-bold text-slate-950">Filter</button>
          </div>
          {params.error ? <div className="mt-3 rounded-xl border border-red-400/25 bg-red-400/10 p-3 text-sm text-red-100">{params.error}</div> : null}
          {params.saved ? <div className="mt-3 rounded-xl border border-emerald-400/25 bg-emerald-400/10 p-3 text-sm text-emerald-100">Saved.</div> : null}
        </form>

        <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
          <div className="grid grid-cols-[1.3fr_1fr_0.8fr_0.9fr_1fr] gap-4 border-b border-white/10 px-5 py-3 text-xs font-black uppercase tracking-wide text-slate-500">
            <div>User</div><div>Organization</div><div>Role</div><div>Access</div><div>Override</div>
          </div>
          <div className="divide-y divide-white/10">
            {rows.map(({ profile, member, org, activeOverride, access }) => (
              <div key={profile.id} className="grid grid-cols-[1.3fr_1fr_0.8fr_0.9fr_1fr] gap-4 px-5 py-4 text-sm">
                <div className="min-w-0"><div className="truncate font-bold text-white">{profile.full_name || profile.email || 'User'}</div><div className="truncate text-slate-500">{profile.email}</div><div className="mt-1 text-xs text-slate-600">Joined {dateText(profile.created_at)}</div></div>
                <div className="min-w-0"><div className="truncate text-slate-200">{org?.name || profile.organization_name || '—'}</div><div className="mt-1 text-xs text-slate-500">{org?.account_type || profile.account_type || '—'}</div></div>
                <div>{badge(String(member?.role || 'no org'))}</div>
                <div>{badge(access.label, access.tone)}</div>
                <div>
                  {activeOverride ? (
                    <form action={revokeUserAccessOverrideAction} className="space-y-2"><input type="hidden" name="override_id" value={activeOverride.id} /><div className="text-xs text-blue-100">Active override{activeOverride.expires_at ? ` until ${dateText(activeOverride.expires_at)}` : ''}</div><button className="rounded-lg border border-red-400/25 px-3 py-2 text-xs font-bold text-red-100 hover:bg-red-400/10">Revoke</button></form>
                  ) : (
                    <form action={grantUserFullAccessOverrideAction} className="space-y-2"><input type="hidden" name="user_id" value={profile.id} /><input type="hidden" name="organization_id" value={org?.id || ''} /><input name="reason" placeholder="Reason" className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-xs" /><button className="rounded-lg border border-blue-400/25 px-3 py-2 text-xs font-bold text-blue-100 hover:bg-blue-400/10">Grant full access</button></form>
                  )}
                </div>
              </div>
            ))}
            {!rows.length ? <div className="p-10 text-center text-slate-500">No users match these filters.</div> : null}
          </div>
        </section>
      </div>
    </AppShell>
  )
}
