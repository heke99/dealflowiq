import Link from 'next/link'
import { ArrowRight, BadgeDollarSign, Building2, DatabaseZap, ShieldCheck, Users } from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'

type Row = Record<string, any>
type Tone = 'default' | 'green' | 'amber' | 'red' | 'blue'

function numberText(value: number | null | undefined) {
  return new Intl.NumberFormat('en-US').format(Number(value || 0))
}

function dateText(value?: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

function price(cents?: number | null) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(cents || 0) / 100)
}

function statusLabel(value?: string | null) {
  if (!value || value === 'trialing') return 'active'
  return String(value).replaceAll('_', ' ')
}

function Stat({ label, value, hint, href, tone = 'default' }: { label: string; value: string; hint: string; href?: string; tone?: Tone }) {
  const tones: Record<Tone, string> = {
    default: 'border-white/10 bg-white/[0.035]',
    green: 'border-emerald-400/25 bg-emerald-400/10',
    amber: 'border-amber-400/25 bg-amber-400/10',
    red: 'border-red-400/25 bg-red-400/10',
    blue: 'border-blue-400/25 bg-blue-400/10',
  }
  const card = (
    <div className={`h-full rounded-3xl border p-5 transition hover:border-white/25 hover:bg-white/[0.06] ${tones[tone]}`}>
      <div className="text-sm font-bold text-slate-400">{label}</div>
      <div className="mt-3 text-3xl font-black">{value}</div>
      <div className="mt-3 text-xs leading-5 text-slate-500">{hint}</div>
    </div>
  )
  return href ? <Link href={href}>{card}</Link> : card
}

function AdminAction({ icon: Icon, title, text, href, cta }: { icon: any; title: string; text: string; href: string; cta: string }) {
  return (
    <Link href={href} className="group rounded-3xl border border-white/10 bg-white/[0.035] p-5 transition hover:border-white/25 hover:bg-white/[0.07]">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-slate-950/60 text-blue-100"><Icon className="h-5 w-5" /></div>
        <div>
          <h2 className="text-lg font-black">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">{text}</p>
        </div>
      </div>
      <div className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm font-black text-slate-950 group-hover:bg-slate-200">
        {cta}
        <ArrowRight className="h-4 w-4" />
      </div>
    </Link>
  )
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
  const [plansResult, activePlansResult, orgsResult, subsResult, activeSubsResult, invitesResult, activeInvitesResult, jobsResult, failedJobsResult, listingsResult] = await Promise.all([
    supabase.from('billing_plans').select('id', { count: 'exact', head: true }),
    supabase.from('billing_plans').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('organizations').select('id', { count: 'exact', head: true }),
    supabase.from('organization_subscriptions').select('id, organization_id, status, current_period_end, updated_at, organizations(name), billing_plans(name, code, monthly_price_cents)').order('updated_at', { ascending: false }).limit(8),
    supabase.from('organization_subscriptions').select('id', { count: 'exact', head: true }).in('status', ['active', 'trialing', 'manually_granted', 'comped']),
    supabase.from('admin_access_invites').select('id,email,organization_name,account_type,role,status,expires_at,created_at,billing_plans(name)').order('created_at', { ascending: false }).limit(6),
    supabase.from('admin_access_invites').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    orgId ? supabase.from('market_import_jobs').select('status,items_created,items_updated,items_failed,error_message,created_at,source_url').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(6) : Promise.resolve({ data: [] as Row[] }),
    orgId ? supabase.from('market_import_jobs').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'failed') : Promise.resolve({ count: 0 }),
    orgId ? supabase.from('market_listings').select('id', { count: 'exact', head: true }).eq('organization_id', orgId) : Promise.resolve({ count: 0 }),
  ])

  const jobs = (jobsResult.data || []) as Row[]
  const invites = (invitesResult.data || []) as Row[]
  const subscriptions = (subsResult.data || []) as Row[]
  const failedImports = Number(failedJobsResult.count || 0)

  return (
    <AppShell organizationName={workspace.organization?.name} userEmail={workspace.user.email} accountType={workspace.access.accountType} features={workspace.access.features} subscriptionStatus={workspace.access.status} planName={workspace.access.plan?.name} trialEndsAt={workspace.access.trialEndsAt} isPlatformAdmin={workspace.access.isPlatformAdmin}>
      <div className="space-y-8">
        <section className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-blue-500/15 via-slate-950 to-emerald-500/10 p-6 shadow-2xl shadow-black/20 sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-400/10 px-4 py-2 text-sm font-black uppercase tracking-wide text-blue-100">
                <ShieldCheck className="h-4 w-4" />
                Platform control center
              </div>
              <h1 className="mt-4 text-4xl font-black tracking-tight sm:text-5xl">Admin Dashboard</h1>
              <p className="mt-3 max-w-3xl text-slate-300">Manage plans, organization subscriptions, access invites and import health from one production-ready operator view.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/admin/plans" className="rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950 hover:bg-slate-200">Plans & subscriptions</Link>
              <Link href="/admin/access" className="rounded-2xl border border-white/10 px-5 py-3 text-sm font-bold text-white hover:bg-white/10">Create invite</Link>
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Stat label="Organizations" value={numberText(orgsResult.count || 0)} hint="Total workspaces in the platform." tone="blue" />
          <Stat label="Active access" value={numberText(activeSubsResult.count || 0)} hint="Organizations with usable subscription access." href="/admin/plans" tone="green" />
          <Stat label="Active plans" value={numberText(activePlansResult.count || 0)} hint={`${numberText(plansResult.count || 0)} total plan records.`} href="/admin/plans" />
          <Stat label="Open invites" value={numberText(activeInvitesResult.count || 0)} hint="Pending access grants." href="/admin/access" tone="amber" />
          <Stat label="Failed imports" value={numberText(failedImports)} hint="Import jobs needing operator review." href="/market?tab=sources" tone={failedImports > 0 ? 'red' : 'green'} />
        </section>

        <section className="grid gap-5 lg:grid-cols-3">
          <AdminAction icon={BadgeDollarSign} title="Create or edit plans" text="Change plan names, prices, limits and included features. Delete plans safely with replacement sync." href="/admin/plans" cta="Manage plans" />
          <AdminAction icon={Building2} title="Sync organization subscriptions" text="Assign a plan to a workspace, activate access, cancel access or update current-period dates." href="/admin/plans#subscriptions" cta="Open subscriptions" />
          <AdminAction icon={Users} title="Grant access by invite" text="Invite users, set workspace type and attach a plan before they sign up." href="/admin/access" cta="Create invite" />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black">Latest subscriptions</h2>
                <p className="mt-1 text-sm text-slate-500">Recent organization plan assignments and access status.</p>
              </div>
              <Link href="/admin/plans#subscriptions" className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-white/10">Manage</Link>
            </div>
            <div className="mt-5 space-y-3">
              {subscriptions.length ? subscriptions.map((sub) => {
                const org = Array.isArray(sub.organizations) ? sub.organizations[0] : sub.organizations
                const plan = Array.isArray(sub.billing_plans) ? sub.billing_plans[0] : sub.billing_plans
                return (
                  <div key={sub.id} className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="truncate font-black">{org?.name || sub.organization_id}</div>
                        <div className="mt-1 text-xs text-slate-500">{plan?.name || 'No plan'} · {plan?.monthly_price_cents ? `${price(plan.monthly_price_cents)}/mo` : 'custom pricing'}</div>
                      </div>
                      <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-black uppercase text-emerald-100">{statusLabel(sub.status)}</span>
                    </div>
                    <div className="mt-3 text-xs text-slate-500">Updated {dateText(sub.updated_at)} · Period ends {dateText(sub.current_period_end)}</div>
                  </div>
                )
              }) : <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-slate-400">No subscriptions found.</div>}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-6">
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

            <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-black">Import health</h2>
                  <p className="mt-1 text-sm text-slate-500">Recent provider jobs and issues.</p>
                </div>
                <DatabaseZap className="h-5 w-5 text-slate-500" />
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
                )) : <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-slate-400">No import jobs yet.</div>}
              </div>
            </div>
          </div>
        </section>

        <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 text-sm text-slate-400">
          Current admin workspace listings: <span className="font-black text-white">{numberText(listingsResult.count || 0)}</span>. Platform-wide billing and subscription data is handled in Plans & Subscriptions.
        </div>
      </div>
    </AppShell>
  )
}
