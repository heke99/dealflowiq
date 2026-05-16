import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'

type Row = Record<string, any>

function numberText(value: number | null | undefined) {
  return new Intl.NumberFormat('en-US').format(Number(value || 0))
}

function dateText(value?: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

function Stat({ label, value, hint, href, tone = 'default' }: { label: string; value: string; hint: string; href?: string; tone?: 'default' | 'green' | 'amber' | 'red' }) {
  const tones = {
    default: 'border-white/10 bg-white/[0.03]',
    green: 'border-emerald-400/25 bg-emerald-400/10',
    amber: 'border-amber-400/25 bg-amber-400/10',
    red: 'border-red-400/25 bg-red-400/10',
  }
  const card = (
    <div className={`rounded-3xl border p-5 ${tones[tone]}`}>
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-3 text-3xl font-black">{value}</div>
      <div className="mt-3 text-xs leading-5 text-slate-500">{hint}</div>
    </div>
  )
  return href ? <Link href={href}>{card}</Link> : card
}

export default async function AdminDashboardPage() {
  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()

  if (!workspace.access.isPlatformAdmin) {
    return (
      <AppShell organizationName={workspace.organization?.name} userEmail={workspace.user.email} accountType={workspace.access.accountType} features={workspace.access.features} subscriptionStatus={workspace.access.status} planName={workspace.access.plan?.name} trialEndsAt={workspace.access.trialEndsAt} isPlatformAdmin={workspace.access.isPlatformAdmin}>
        <div className="rounded-3xl border border-amber-500/30 bg-amber-500/10 p-8 text-amber-100">
          <h1 className="text-3xl font-black">Platform admin required</h1>
          <p className="mt-3 text-sm">This dashboard is only available to platform admins.</p>
        </div>
      </AppShell>
    )
  }

  const orgId = workspace.organization?.id
  const [plansResult, invitesResult, activeInvitesResult, jobsResult, failedJobsResult, listingsResult, notificationsResult] = await Promise.all([
    supabase.from('billing_plans').select('id', { count: 'exact', head: true }),
    supabase.from('admin_access_invites').select('id,email,organization_name,account_type,role,status,expires_at,created_at,billing_plans(name)').order('created_at', { ascending: false }).limit(8),
    supabase.from('admin_access_invites').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    orgId ? supabase.from('market_import_jobs').select('status,items_created,items_updated,items_failed,error_message,created_at,source_url').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(8) : Promise.resolve({ data: [] as Row[] }),
    orgId ? supabase.from('market_import_jobs').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'failed') : Promise.resolve({ count: 0 }),
    orgId ? supabase.from('market_listings').select('id', { count: 'exact', head: true }).eq('organization_id', orgId) : Promise.resolve({ count: 0 }),
    orgId ? supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).is('read_at', null).is('archived_at', null) : Promise.resolve({ count: 0 }),
  ])

  const jobs = (jobsResult.data || []) as Row[]
  const invites = (invitesResult.data || []) as Row[]

  return (
    <AppShell organizationName={workspace.organization?.name} userEmail={workspace.user.email} accountType={workspace.access.accountType} features={workspace.access.features} subscriptionStatus={workspace.access.status} planName={workspace.access.plan?.name} trialEndsAt={workspace.access.trialEndsAt} isPlatformAdmin={workspace.access.isPlatformAdmin}>
      <div className="space-y-8">
        <section className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-blue-500/15 via-slate-950 to-emerald-500/10 p-6 sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-sm font-black uppercase tracking-wide text-blue-300">Platform operations</div>
              <h1 className="mt-3 text-4xl font-black tracking-tight">Admin Dashboard</h1>
              <p className="mt-3 max-w-3xl text-slate-300">Manage plans, invites, access grants and import health from one operator view. This area should feel like a real SaaS control center, not a developer-only backend.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/admin/access" className="rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950 hover:bg-slate-200">Create invite</Link>
              <Link href="/admin/plans" className="rounded-2xl border border-white/10 px-5 py-3 text-sm font-bold text-white hover:bg-white/10">Manage plans</Link>
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Plans" value={numberText(plansResult.count || 0)} hint="Billing plans configured in platform." href="/admin/plans" />
          <Stat label="Active invites" value={numberText(activeInvitesResult.count || 0)} hint="Outstanding access grants." href="/admin/access" tone="green" />
          <Stat label="Workspace listings" value={numberText(listingsResult.count || 0)} hint="Listings in this admin workspace." href="/market" />
          <Stat label="Failed imports" value={numberText(failedJobsResult.count || 0)} hint="Import issues needing operator review." href="/market?tab=sources" tone={(failedJobsResult.count || 0) > 0 ? 'red' : 'green'} />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black">Recent access invites</h2>
                <p className="mt-1 text-sm text-slate-500">Track user onboarding and manual grants.</p>
              </div>
              <Link href="/admin/access" className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-white/10">Open</Link>
            </div>
            <div className="mt-5 space-y-3">
              {invites.length ? invites.map((invite) => {
                const plan = Array.isArray(invite.billing_plans) ? invite.billing_plans[0] : invite.billing_plans
                return (
                  <div key={invite.id} className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="truncate font-bold">{invite.email}</div>
                        <div className="mt-1 text-xs text-slate-500">{invite.organization_name || 'Workspace pending'} · {invite.account_type} · {plan?.name || 'default plan'}</div>
                      </div>
                      <span className="rounded-full border border-white/10 px-3 py-1 text-xs font-bold uppercase text-slate-300">{invite.status}</span>
                    </div>
                    <div className="mt-3 text-xs text-slate-500">Created {dateText(invite.created_at)} · Expires {dateText(invite.expires_at)}</div>
                  </div>
                )
              }) : <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-slate-400">No invites yet.</div>}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black">Import health</h2>
                <p className="mt-1 text-sm text-slate-500">Recent provider jobs and issues.</p>
              </div>
              <Link href="/market?tab=sources" className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-white/10">Sources</Link>
            </div>
            <div className="mt-5 space-y-3">
              {jobs.length ? jobs.map((job, index) => (
                <div key={`${job.created_at}-${index}`} className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-bold capitalize">{String(job.status || 'queued').replaceAll('_', ' ')}</div>
                      <div className="mt-1 truncate text-xs text-slate-500">{job.source_url || 'Import job'}</div>
                    </div>
                    <span className="text-xs text-slate-500">{dateText(job.created_at)}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-400">
                    <div>Created <span className="block font-bold text-slate-100">{numberText(job.items_created || 0)}</span></div>
                    <div>Updated <span className="block font-bold text-slate-100">{numberText(job.items_updated || 0)}</span></div>
                    <div>Failed <span className="block font-bold text-slate-100">{numberText(job.items_failed || 0)}</span></div>
                  </div>
                  {job.error_message ? <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-100">{job.error_message}</div> : null}
                </div>
              )) : <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-slate-400">No jobs yet.</div>}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-2xl font-black">Operator checklist</h2>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {[
              ['Plans configured', 'Keep plan names, limits and feature gates ready for sales demos.'],
              ['Access grants controlled', 'Use admin invites instead of manually editing users.'],
              ['Import failures visible', 'Investigate failed jobs before they become user support issues.'],
            ].map(([title, text]) => (
              <div key={title} className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                <div className="font-bold text-white">{title}</div>
                <div className="mt-2 text-sm leading-6 text-slate-400">{text}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  )
}
