import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getAccountTypeConfig } from '@/lib/product/accountTypes'
import { OPPORTUNITY_RENT_CONFIDENCE_THRESHOLD, OPPORTUNITY_SCORE_THRESHOLD, STRONG_OPPORTUNITY_RENT_CONFIDENCE_THRESHOLD, STRONG_OPPORTUNITY_SCORE_THRESHOLD } from '@/lib/market/opportunityRules'

type Row = Record<string, any>

function money(value: number | string | null | undefined, compact = false) {
  const parsed = Number(value || 0)
  if (!parsed) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, notation: compact ? 'compact' : 'standard' }).format(parsed)
}

function numberText(value: number | null | undefined) {
  return new Intl.NumberFormat('en-US').format(Number(value || 0))
}

function dateText(value?: string | null) {
  if (!value) return 'No date set'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
}

function StatCard({ label, value, hint, href, tone = 'default' }: { label: string; value: string; hint: string; href?: string; tone?: 'default' | 'green' | 'amber' | 'red' }) {
  const tones = {
    default: 'border-white/10 bg-white/[0.03]',
    green: 'border-emerald-400/25 bg-emerald-400/10',
    amber: 'border-amber-400/25 bg-amber-400/10',
    red: 'border-red-400/25 bg-red-400/10',
  }
  const content = (
    <div className={`rounded-3xl border p-5 transition hover:border-white/25 hover:bg-white/[0.06] ${tones[tone]}`}>
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-3 text-3xl font-black tracking-tight">{value}</div>
      <div className="mt-3 text-xs leading-5 text-slate-500">{hint}</div>
    </div>
  )
  return href ? <Link href={href}>{content}</Link> : content
}

function ActionCard({ title, text, href, cta }: { title: string; text: string; href: string; cta: string }) {
  return (
    <Link href={href} className="group rounded-3xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-white/25 hover:bg-white/[0.06]">
      <div className="text-lg font-black text-white">{title}</div>
      <p className="mt-2 min-h-12 text-sm leading-6 text-slate-400">{text}</p>
      <div className="mt-5 inline-flex rounded-xl bg-white px-4 py-2 text-sm font-black text-slate-950 group-hover:bg-slate-200">{cta}</div>
    </Link>
  )
}

function OpportunityRow({ listing }: { listing: Row }) {
  const score = Math.round(Number(listing.latest_deal_score || 0))
  const rentConfidence = Math.round(Number(listing.latest_rent_confidence_score || 0))
  const strong = score >= STRONG_OPPORTUNITY_SCORE_THRESHOLD && rentConfidence >= STRONG_OPPORTUNITY_RENT_CONFIDENCE_THRESHOLD
  return (
    <Link href={`/market/${listing.id}`} className="block rounded-2xl border border-white/10 bg-slate-950/50 p-4 transition hover:border-white/20 hover:bg-white/[0.06]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <span className={strong ? 'rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-100' : 'rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-slate-300'}>{strong ? 'Strong Opportunity' : 'Opportunity'}</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-bold text-slate-400">Rent {rentConfidence}</span>
          </div>
          <div className="mt-2 line-clamp-1 font-bold text-slate-100">{listing.title || listing.address || 'Market listing'}</div>
          <div className="mt-1 text-xs text-slate-500">{[listing.city, listing.state, listing.zip_code].filter(Boolean).join(', ') || 'Location pending'}</div>
        </div>
        <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-center text-emerald-100">
          <div className="text-[10px] uppercase tracking-wide">Score</div>
          <div className="text-lg font-black">{score}</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-400">
        <div>Price <span className="block font-bold text-slate-100">{money(listing.list_price || listing.asking_price, true)}</span></div>
        <div>Cashflow <span className="block font-bold text-slate-100">{money(listing.latest_estimated_monthly_cashflow, true)}</span></div>
        <div>DSCR <span className="block font-bold text-slate-100">{listing.latest_estimated_dscr ? Number(listing.latest_estimated_dscr).toFixed(2) : '—'}</span></div>
      </div>
    </Link>
  )
}

export default async function DashboardPage() {
  const workspace = await getCurrentWorkspace()
  const accountType = workspace.access.accountType
  const config = getAccountTypeConfig(accountType)
  const supabase = await createSupabaseServerClient()
  const orgId = workspace.organization?.id

  const [dealsResult, listingsResult, opportunitiesResult, strongResult, reviewResult, importJobsResult, buyerMatchResult, watchResult, notificationsResult, sourcesResult] = orgId
    ? await Promise.all([
        supabase.from('deals').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
        supabase.from('market_listings').select('id', { count: 'exact', head: true }).or(`organization_id.eq.${orgId},visibility.eq.public`),
        supabase.from('market_listings').select('*').or(`organization_id.eq.${orgId},visibility.eq.public`).gte('latest_deal_score', OPPORTUNITY_SCORE_THRESHOLD).gte('latest_rent_confidence_score', OPPORTUNITY_RENT_CONFIDENCE_THRESHOLD).neq('status', 'archived').order('latest_deal_score', { ascending: false }).limit(6),
        supabase.from('market_listings').select('id', { count: 'exact', head: true }).or(`organization_id.eq.${orgId},visibility.eq.public`).gte('latest_deal_score', STRONG_OPPORTUNITY_SCORE_THRESHOLD).gte('latest_rent_confidence_score', STRONG_OPPORTUNITY_RENT_CONFIDENCE_THRESHOLD).neq('status', 'archived'),
        supabase.from('market_listings').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).in('deal_status', ['needs_review', 'missing_data', 'low_confidence']),
        supabase.from('market_import_jobs').select('status,items_created,items_updated,items_failed,error_message,created_at,source_url').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(5),
        supabase.from('buyer_deal_matches').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).gte('match_score', 70),
        supabase.from('market_watchlist').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('user_id', workspace.user.id),
        supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).or(`user_id.is.null,user_id.eq.${workspace.user.id}`).is('read_at', null).is('archived_at', null),
        supabase.from('market_sources').select('id,status,auto_import_enabled', { count: 'exact' }).eq('organization_id', orgId),
      ])
    : [{ count: 0 }, { count: 0 }, { data: [] }, { count: 0 }, { count: 0 }, { data: [] }, { count: 0 }, { count: 0 }, { count: 0 }, { data: [], count: 0 }]

  const opportunities = (opportunitiesResult.data || []) as Row[]
  const importJobs = (importJobsResult.data || []) as Row[]
  const failedJobs = importJobs.filter((job) => job.status === 'failed').length
  const runningJobs = importJobs.filter((job) => ['queued', 'running', 'processing', 'importing'].includes(String(job.status))).length
  const activeSources = ((sourcesResult.data || []) as Row[]).filter((source) => source.status === 'active' || source.auto_import_enabled).length

  return (
    <AppShell organizationName={workspace.organization?.name} userEmail={workspace.user.email} accountType={accountType} features={workspace.access.features} subscriptionStatus={workspace.access.status} planName={workspace.access.plan?.name} trialEndsAt={workspace.access.trialEndsAt} isPlatformAdmin={workspace.access.isPlatformAdmin}>
      <div className="space-y-8">
        <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-emerald-500/15 via-slate-950 to-blue-500/10 p-6 sm:p-8">
          <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
            <div>
              <div className="text-sm font-black uppercase tracking-wide text-emerald-300">DealFlowIQ command center</div>
              <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">Good to see you. Your {config.shortTitle.toLowerCase()} pipeline is ready.</h1>
              <p className="mt-4 max-w-3xl text-slate-300">Import authorized URLs, review Market, push qualified listings into Opportunities and keep your underwriting assumptions synced across the whole workspace.</p>
              {workspace.error ? <div className="mt-5 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">Supabase setup issue: {workspace.error}</div> : null}
              <div className="mt-7 flex flex-wrap gap-3">
                <Link href="/imports" className="rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950 hover:bg-slate-200">Import listings</Link>
                <Link href="/opportunities" className="rounded-2xl border border-white/10 px-5 py-3 text-sm font-bold text-white hover:bg-white/10">Review opportunities</Link>
                <Link href="/buy-boxes" className="rounded-2xl border border-white/10 px-5 py-3 text-sm font-bold text-white hover:bg-white/10">Buy boxes</Link>
              </div>
            </div>
            <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-slate-400">Opportunity rule</div>
                  <div className="mt-1 text-xl font-black">{OPPORTUNITY_SCORE_THRESHOLD}+ score / {OPPORTUNITY_RENT_CONFIDENCE_THRESHOLD}+ rent confidence</div>
                </div>
                <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-center text-emerald-100">
                  <div className="text-xs uppercase tracking-wide">Strong</div>
                  <div className="text-2xl font-black">{STRONG_OPPORTUNITY_SCORE_THRESHOLD}+</div>
                </div>
              </div>
              <div className="mt-5 grid gap-3 text-sm text-slate-300">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">Plan: <span className="font-bold text-white">{workspace.access.plan?.name || 'Trial'}</span></div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">Trial ends: <span className="font-bold text-white">{dateText(workspace.access.trialEndsAt)}</span></div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">Unread notifications: <span className="font-bold text-white">{numberText(notificationsResult.count || 0)}</span></div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Market listings" value={numberText(listingsResult.count || 0)} hint="All accessible listings in Market." href="/market" />
          <StatCard label="Opportunities" value={numberText(opportunities.length)} hint="Qualified with current score rules." href="/opportunities" tone="green" />
          <StatCard label="Strong opportunities" value={numberText(strongResult.count || 0)} hint="85+ score and 65+ rent confidence." href="/opportunities" tone="green" />
          <StatCard label="Needs review" value={numberText(reviewResult.count || 0)} hint="Missing data, low confidence or manual review." href="/market?tab=needs_review" tone="amber" />
          <StatCard label="My deals" value={numberText(dealsResult.count || 0)} hint="Saved/manual underwriting deals." href="/deals" />
          <StatCard label="Saved deals" value={numberText(watchResult.count || 0)} hint="Your personal watchlist." href="/saved-deals" />
          <StatCard label="Buyer matches" value={numberText(buyerMatchResult.count || 0)} hint="Potential buyer/deal matches." href="/buyers" />
          <StatCard label="Import health" value={failedJobs ? `${failedJobs} failed` : runningJobs ? `${runningJobs} running` : 'Healthy'} hint={`${activeSources} active/importable source configs.`} href="/imports" tone={failedJobs ? 'red' : runningJobs ? 'amber' : 'green'} />
        </section>

        <section className="grid gap-5 lg:grid-cols-3">
          <ActionCard title="Run a source import" text="Paste a direct listing or search URL, preview the first allowed listings and import them into Market." href="/imports" cta="Open imports" />
          <ActionCard title="Review qualified opportunities" text="See listings that meet the current Opportunity rule and jump into underwriting detail." href="/opportunities" cta="Open opportunities" />
          <ActionCard title="Tune your buy boxes" text="Create filters for areas, price ranges and return targets so new matches surface faster." href="/buy-boxes" cta="Manage buy boxes" />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black">Top opportunities</h2>
                <p className="mt-1 text-sm text-slate-500">Best current listings by synced Market score.</p>
              </div>
              <Link href="/opportunities" className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-white/10">View all</Link>
            </div>
            <div className="mt-5 grid gap-3">
              {opportunities.length ? opportunities.map((listing) => <OpportunityRow key={listing.id} listing={listing} />) : (
                <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-slate-400">
                  No qualified opportunities yet. Import listings or update analysis inputs to sync scores.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black">Recent imports</h2>
                <p className="mt-1 text-sm text-slate-500">Track jobs, errors and created listings.</p>
              </div>
              <Link href="/imports" className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-white/10">Run import</Link>
            </div>
            <div className="mt-5 space-y-3">
              {importJobs.length ? importJobs.map((job, index) => (
                <div key={`${job.created_at}-${index}`} className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-bold capitalize">{String(job.status || 'queued').replaceAll('_', ' ')}</div>
                      <div className="mt-1 truncate text-xs text-slate-500">{job.source_url || 'Manual/import job'}</div>
                    </div>
                    <div className="text-right text-xs text-slate-500">{dateText(job.created_at)}</div>
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
        </section>
      </div>
    </AppShell>
  )
}
