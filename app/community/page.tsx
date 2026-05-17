import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createCommunityInviteAction, createCommunityTeamAction, revokeCommunityInviteAction } from '@/app/community/actions'

type Row = Record<string, any>

type CommunityPageProps = {
  searchParams?: Promise<{ error?: string; message?: string; code?: string }> | { error?: string; message?: string; code?: string }
}

function fmtDate(value?: string | null) {
  if (!value) return 'No expiry'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
}

function inviteLink(code: string) {
  return `/signup?invite=${encodeURIComponent(code)}`
}

function StatusPill({ value }: { value: string }) {
  const tone = value === 'active' ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100' : value === 'accepted' ? 'border-blue-400/30 bg-blue-400/10 text-blue-100' : 'border-slate-400/20 bg-slate-400/10 text-slate-200'
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${tone}`}>{value.replaceAll('_', ' ')}</span>
}

export default async function CommunityPage({ searchParams }: CommunityPageProps) {
  const params = await Promise.resolve(searchParams || {})
  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()
  const orgId = workspace.organization?.id
  const role = workspace.membership?.role
  const canManage = Boolean(['owner', 'admin'].includes(role || '') || workspace.access.isPlatformAdmin)

  const [teamsResult, invitesResult, membersResult, postedDealsResult, watchlistResult] = orgId
    ? await Promise.all([
        supabase.from('community_teams').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }),
        supabase.from('community_invites').select('*, community_teams(name)').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(25),
        supabase.from('organization_members').select('id,user_id,role,status,created_at,profiles:user_id(email,full_name,avatar_url,account_type,onboarding_completed)').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(100),
        supabase.from('market_listings').select('id,created_by,deal_status,status').eq('organization_id', orgId).limit(1000),
        supabase.from('market_watchlist').select('id,user_id,status,listing_id').eq('organization_id', orgId).limit(1000),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }]

  const teams = (teamsResult.data || []) as Row[]
  const invites = (invitesResult.data || []) as Row[]
  const members = (membersResult.data || []) as Row[]
  const postedDeals = (postedDealsResult.data || []) as Row[]
  const watchlistRows = (watchlistResult.data || []) as Row[]
  const memberStats = new Map<string, { posted: number; saved: number; contacted: number; converted: number }>()
  for (const member of members) memberStats.set(String(member.user_id), { posted: 0, saved: 0, contacted: 0, converted: 0 })
  for (const deal of postedDeals) {
    const stats = memberStats.get(String(deal.created_by))
    if (stats) {
      stats.posted += 1
      if (['converted_to_deal', 'under_contract', 'closed'].includes(String(deal.status)) || ['converted_to_deal', 'under_contract', 'closed'].includes(String(deal.deal_status))) stats.converted += 1
    }
  }
  for (const item of watchlistRows) {
    const stats = memberStats.get(String(item.user_id))
    if (stats) {
      stats.saved += 1
      if (['contacted', 'under_contract', 'converted_to_deal'].includes(String(item.status))) stats.contacted += 1
    }
  }
  const topPoster = [...memberStats.entries()].sort((a, b) => b[1].posted - a[1].posted)[0]?.[1]?.posted || 0
  const activeInvites = invites.filter((invite) => invite.status === 'active').length
  const acceptedInvites = invites.filter((invite) => invite.status === 'accepted').length

  return (
    <AppShell
      organizationName={workspace.organization?.name}
      userEmail={workspace.user.email}
      accountType={workspace.access.accountType}
      features={workspace.access.features}
      subscriptionStatus={workspace.access.status}
      planName={workspace.access.plan?.name}
      trialEndsAt={workspace.access.trialEndsAt}
      isPlatformAdmin={workspace.access.isPlatformAdmin}
    >
      <div className="space-y-8">
        <section className="overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900 via-slate-950 to-black p-6 sm:p-8">
          <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
            <div>
              <div className="text-sm font-semibold uppercase tracking-wide text-emerald-300">Community growth center</div>
              <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-5xl">Invite members into the right community team.</h1>
              <p className="mt-4 max-w-3xl text-slate-300">
                Create invite codes, optionally send email invites, and let members sign up into the correct DealFlowIQ community and team automatically.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/signup" className="rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-slate-100 hover:bg-white/10">Preview signup</Link>
                <Link href="/dashboard" className="rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-slate-100 hover:bg-white/10">Back to dashboard</Link>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><div className="text-sm text-slate-400">Members</div><div className="mt-2 text-3xl font-bold">{members.length}</div></div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><div className="text-sm text-slate-400">Active invites</div><div className="mt-2 text-3xl font-bold">{activeInvites}</div></div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><div className="text-sm text-slate-400">Teams</div><div className="mt-2 text-3xl font-bold">{teams.length}</div></div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><div className="text-sm text-slate-400">Top poster deals</div><div className="mt-2 text-3xl font-bold">{topPoster}</div></div>
            </div>
          </div>
        </section>

        {params.error ? <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">{decodeURIComponent(params.error)}</div> : null}
        {params.message ? <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">{decodeURIComponent(params.message)}{params.code ? <span className="ml-2 font-mono font-bold">{params.code}</span> : null}</div> : null}

        <section className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
          <div className="space-y-6">
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xl font-bold">Create invite</h2>
              <p className="mt-2 text-sm text-slate-400">Send by email when configured, or create a code/link you can copy and share manually.</p>
              {canManage ? (
                <form action={createCommunityInviteAction} className="mt-5 space-y-4">
                  <label className="block"><span className="text-sm font-medium text-slate-300">Email address</span><input name="email" type="email" placeholder="member@example.com" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-white/30" /></label>
                  <label className="block"><span className="text-sm font-medium text-slate-300">Full name</span><input name="full_name" placeholder="Optional" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-white/30" /></label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block"><span className="text-sm font-medium text-slate-300">Team</span><select name="team_id" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white outline-none focus:border-white/30"><option value="">No team</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
                    <label className="block"><span className="text-sm font-medium text-slate-300">Role</span><select name="role" defaultValue="member" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white outline-none focus:border-white/30"><option value="member">Member</option><option value="viewer">Viewer</option><option value="buyer">Buyer</option><option value="acquisition_manager">Acquisition manager</option><option value="disposition_manager">Disposition manager</option><option value="admin">Admin</option></select></label>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block"><span className="text-sm font-medium text-slate-300">Max uses</span><input name="max_uses" type="number" min="1" max="500" defaultValue="1" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white outline-none focus:border-white/30" /></label>
                    <label className="block"><span className="text-sm font-medium text-slate-300">Expires in days</span><input name="expires_in_days" type="number" min="1" max="365" defaultValue="14" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white outline-none focus:border-white/30" /></label>
                  </div>
                  <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-slate-900/70 p-4 text-sm text-slate-300"><input name="send_email" type="checkbox" className="mt-1" /><span><span className="font-semibold text-white">Send email invite</span><br /><span className="text-slate-500">Requires RESEND_API_KEY. Without it, DealFlowIQ still creates the invite code and signup link.</span></span></label>
                  <button className="w-full rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-200">Create invite</button>
                </form>
              ) : <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">Only owners and admins can create invites.</div>}
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xl font-bold">Create team</h2>
              <p className="mt-2 text-sm text-slate-400">Teams make invite codes smarter. A member who signs up with a team invite is assigned immediately.</p>
              {canManage ? (
                <form action={createCommunityTeamAction} className="mt-5 space-y-4">
                  <input name="name" placeholder="Ohio Buyers, Beginner Cohort, VIP Group..." className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-white/30" />
                  <textarea name="description" placeholder="Optional team description" rows={3} className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-white/30" />
                  <button className="w-full rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-slate-100 hover:bg-white/10">Create team</button>
                </form>
              ) : null}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <div className="flex items-center justify-between gap-4"><div><h2 className="text-xl font-bold">Recent invites</h2><p className="mt-2 text-sm text-slate-400">Copy code or link. Members land in the right community and team on signup.</p></div><div className="text-sm text-slate-400">Accepted: {acceptedInvites}</div></div>
              <div className="mt-5 space-y-3">
                {invites.map((invite) => {
                  const code = String(invite.invite_code || '')
                  return (
                    <div key={invite.id} className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-mono text-lg font-bold tracking-wider text-white">{code}</div>
                          <div className="mt-1 text-sm text-slate-400">{invite.email || 'Reusable code'}{invite.community_teams?.name ? ` · ${invite.community_teams.name}` : ''}</div>
                        </div>
                        <StatusPill value={invite.status} />
                      </div>
                      <div className="mt-4 grid gap-2 text-xs text-slate-500 sm:grid-cols-4">
                        <div>Role <span className="block text-slate-200">{String(invite.role).replaceAll('_', ' ')}</span></div>
                        <div>Uses <span className="block text-slate-200">{invite.accepted_count}/{invite.max_uses}</span></div>
                        <div>Email <span className="block text-slate-200">{String(invite.delivery_status).replaceAll('_', ' ')}</span></div>
                        <div>Expires <span className="block text-slate-200">{fmtDate(invite.expires_at)}</span></div>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2 text-sm">
                        <Link href={inviteLink(code)} className="rounded-xl border border-white/10 px-3 py-2 font-semibold text-slate-100 hover:bg-white/10">Open signup link</Link>
                        {invite.status === 'active' && canManage ? <form action={revokeCommunityInviteAction}><input type="hidden" name="invite_id" value={invite.id} /><button className="rounded-xl border border-red-400/20 px-3 py-2 font-semibold text-red-100 hover:bg-red-400/10">Revoke</button></form> : null}
                      </div>
                      {invite.delivery_error ? <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-xs text-amber-100">Email note: {invite.delivery_error}</div> : null}
                    </div>
                  )
                })}
                {!invites.length ? <div className="rounded-2xl border border-dashed border-white/15 p-5 text-sm text-slate-500">No invites yet. Create a code or email invite to start adding members.</div> : null}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <div className="flex items-center justify-between gap-4"><div><h2 className="text-xl font-bold">Members & profiles</h2><p className="mt-2 text-sm text-slate-500">Community owners see members, roles, profile details, posted deals and conversion signals.</p></div></div>
              <div className="mt-5 space-y-3">
                {members.map((member) => {
                  const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles
                  const stats = memberStats.get(String(member.user_id)) || { posted: 0, saved: 0, contacted: 0, converted: 0 }
                  return <div key={member.id} className="rounded-2xl border border-white/10 bg-slate-950/50 p-4 text-sm"><div className="flex items-start justify-between gap-4"><div><div className="font-semibold text-white">{profile?.full_name || profile?.email || 'Member'}</div><div className="mt-1 text-slate-500">{profile?.email}</div><div className="mt-1 text-xs text-slate-600">{profile?.account_type || 'investor'} · joined {fmtDate(member.created_at)}</div></div><div className="text-right"><div className="capitalize text-slate-200">{String(member.role).replaceAll('_', ' ')}</div><div className="mt-1 text-xs text-slate-500">{member.status}</div></div></div><div className="mt-4 grid grid-cols-4 gap-2 text-xs text-slate-400"><div>Posted <span className="block font-bold text-white">{stats.posted}</span></div><div>Saved <span className="block font-bold text-white">{stats.saved}</span></div><div>Contacted <span className="block font-bold text-white">{stats.contacted}</span></div><div>Converted <span className="block font-bold text-white">{stats.converted}</span></div></div></div>
                })}
                {!members.length ? <div className="rounded-2xl border border-dashed border-white/15 p-5 text-sm text-slate-500">No members yet.</div> : null}
              </div>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  )
}
