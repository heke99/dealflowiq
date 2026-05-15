import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getAccountTypeConfig } from '@/lib/product/accountTypes'
import { importMarketUrlAction } from '@/app/market/actions'

type Row = Record<string, any>

const featureLabels: Record<string, string> = {
  deals: 'Deals',
  market_search: 'Market Search',
  rent_analysis: 'Rent Analysis',
  calculators: 'Calculators',
  section8_hud: 'Section 8 / HUD',
  market_opportunities: 'Market & Opportunities',
  market_source_imports: 'Source Imports',
  scheduled_market_imports: 'Auto Imports',
  buyers: 'Buyers',
  buyer_matching: 'Buyer Matching',
  brrrr: 'BRRRR',
  five_year_projection: '5-Year Projection',
  public_community_deals: 'Public / Community Deals',
}

function money(value: number | string | null | undefined, compact = false) {
  const parsed = Number(value || 0)
  if (!parsed) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, notation: compact ? 'compact' : 'standard' }).format(parsed)
}

function formatTrialDate(value?: string | null) {
  if (!value) return 'No trial date set'
  return new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(value))
}

function StatCard({ label, value, hint, href }: { label: string; value: string; hint: string; href?: string }) {
  const content = (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-white/20 hover:bg-white/[0.05]">
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-3 text-3xl font-bold">{value}</div>
      <div className="mt-3 text-xs leading-5 text-slate-500">{hint}</div>
    </div>
  )
  return href ? <Link href={href}>{content}</Link> : content
}

function OpportunityMiniCard({ listing, score, index }: { listing: Row; score: Row; index: number }) {
  return (
    <Link href={`/market/${listing.id}`} className="block rounded-2xl border border-white/10 bg-slate-950/50 p-4 transition hover:border-white/20 hover:bg-white/[0.06]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Opportunity #{index + 1}</div>
          <div className="mt-1 line-clamp-1 font-semibold text-slate-100">{listing.title}</div>
          <div className="mt-1 text-xs text-slate-500">{[listing.city, listing.state, listing.zip_code].filter(Boolean).join(', ') || 'Location pending'}</div>
        </div>
        <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-center text-emerald-100">
          <div className="text-[10px] uppercase tracking-wide">Score</div>
          <div className="text-lg font-bold">{Math.round(Number(score.deal_score || 0))}</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-400">
        <div>Price <span className="block font-semibold text-slate-100">{money(listing.list_price || listing.asking_price, true)}</span></div>
        <div>Cashflow <span className="block font-semibold text-slate-100">{money(score.estimated_monthly_cashflow, true)}</span></div>
        <div>HUD gap <span className="block font-semibold text-slate-100">{money(score.hud_rent_gap, true)}</span></div>
      </div>
    </Link>
  )
}

export default async function DashboardPage() {
  const workspace = await getCurrentWorkspace()
  const accountType = workspace.access.accountType
  const config = getAccountTypeConfig(accountType)
  const plan = workspace.access.plan
  const supabase = await createSupabaseServerClient()

  const [dealsResult, marketResult, scoresResult, jobsResult, sourcesResult] = workspace.organization?.id
    ? await Promise.all([
        supabase.from('deals').select('id', { count: 'exact', head: true }).eq('organization_id', workspace.organization.id),
        supabase.from('market_listings').select('id', { count: 'exact', head: true }).or(`organization_id.eq.${workspace.organization.id},visibility.eq.public`),
        supabase.from('market_listing_scores').select('*, market_listings(*)').order('deal_score', { ascending: false }).limit(8),
        supabase.from('market_import_jobs').select('status,items_created,items_updated,items_failed,error_message,created_at').eq('organization_id', workspace.organization.id).order('created_at', { ascending: false }).limit(5),
        supabase.from('market_sources').select('id,auto_import_enabled,status').eq('organization_id', workspace.organization.id),
      ])
    : [{ count: 0 }, { count: 0 }, { data: [] }, { data: [] }, { data: [] }]

  const visibleScores = ((scoresResult.data || []) as Row[]).filter((score) => {
    const listing = score.market_listings as Row | null
    if (!listing) return false
    return listing.visibility === 'public' || listing.organization_id === workspace.organization?.id
  })
  const opportunities = visibleScores.filter((score) => Number(score.deal_score || 0) >= 80)
  const latestFailedJob = ((jobsResult.data || []) as Row[]).find((job) => job.status === 'failed')
  const autoSources = ((sourcesResult.data || []) as Row[]).filter((source) => source.auto_import_enabled && source.status === 'active').length

  const enabledModules = ['market_opportunities', 'market_source_imports', 'scheduled_market_imports', 'public_community_deals', 'section8_hud', 'calculators']
    .map((feature) => ({ feature, label: featureLabels[feature] || feature, enabled: Boolean((workspace.access.features as Record<string, boolean | undefined>)[feature]) || Boolean(workspace.access.isPlatformAdmin) }))

  return (
    <AppShell
      organizationName={workspace.organization?.name}
      userEmail={workspace.user.email}
      accountType={accountType}
      features={workspace.access.features}
      subscriptionStatus={workspace.access.status}
      planName={plan?.name}
      trialEndsAt={workspace.access.trialEndsAt}
      isPlatformAdmin={workspace.access.isPlatformAdmin}
    >
      <div className="flex flex-col gap-8">
        <section className="overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900 via-slate-950 to-black p-6 sm:p-8">
          <div className="grid gap-7 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
            <div>
              <div className="text-sm font-medium uppercase tracking-wide text-emerald-300">DealFlowIQ command center</div>
              <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-5xl">{config.title} dashboard</h1>
              <p className="mt-4 max-w-3xl text-slate-300">Track your own deals, open Market, review 80+ Opportunities and keep source imports running from one simple dashboard.</p>
              {workspace.error ? <div className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">Supabase setup issue: {workspace.error}</div> : null}
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/opportunities" className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-200">Open Opportunities</Link>
                <Link href="/market" className="rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/10">Open Market</Link>
                <Link href="/buy-boxes" className="rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/10">Buy Boxes</Link>
                <Link href="/saved-deals" className="rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/10">Saved Deals</Link>
                <Link href="/deals" className="rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/10">My Deals</Link>
              </div>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
              <h2 className="text-lg font-bold">Quick import</h2>
              <p className="mt-2 text-sm text-slate-400">Paste an authorized listing URL. The system imports, scores and places 80+ deals in Opportunities.</p>
              <form action={importMarketUrlAction} className="mt-4 space-y-3">
                <input name="input_url" placeholder="https://www.zillow.com/homedetails/..." className="w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-white/30" />
                <input type="hidden" name="source_type" value="manual_url" />
                <input type="hidden" name="visibility" value="private" />
                <button className="w-full rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-200">Import listing</button>
              </form>
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="My Deals" value={String(dealsResult.count || 0)} hint="Deals you created or converted from Market." href="/deals" />
          <StatCard label="Market Listings" value={String(marketResult.count || 0)} hint="Imported, public and team-visible listings." href="/market" />
          <StatCard label="Opportunities 80+" value={String(opportunities.length || 0)} hint="Highest-ranked deals ready for review." href="/opportunities" />
          <StatCard label="Auto Sources" value={String(autoSources || 0)} hint="Sources scheduled through the worker." href="/market?tab=sources" />
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold">Top Opportunities</h2>
                <p className="mt-2 text-sm text-slate-400">Only listings scoring 80+ should be treated as Opportunities.</p>
              </div>
              <Link href="/opportunities" className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-white/10">View all</Link>
            </div>
            <div className="mt-5 space-y-3">
              {opportunities.slice(0, 4).map((score, index) => <OpportunityMiniCard key={score.id} score={score} listing={score.market_listings as Row} index={index} />)}
              {!opportunities.length ? <div className="rounded-2xl border border-dashed border-white/15 p-5 text-sm text-slate-500">No 80+ opportunities yet. Import listings or run your scheduled sources.</div> : null}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xl font-bold">Market engine status</h2>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <StatCard label="Latest jobs" value={String((jobsResult.data || []).length)} hint="Recent imports and source runs." href="/market?tab=sources" />
                <StatCard label="Plan" value={plan?.name || 'Trial'} hint={workspace.access.status.replaceAll('_', ' ')} href="/settings/billing" />
              </div>
              {latestFailedJob ? <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-xs text-red-100">Latest import issue: {latestFailedJob.error_message || 'Import failed'}</div> : <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-xs text-emerald-100">No recent import failures.</div>}
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xl font-bold">Unlocked modules</h2>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {enabledModules.map((item) => (
                  <div key={item.feature} className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                    <div className="text-sm font-semibold">{item.label}</div>
                    <div className={item.enabled ? 'mt-2 text-xs text-emerald-300' : 'mt-2 text-xs text-slate-500'}>{item.enabled ? 'Enabled' : 'Premium / upgrade'}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xl font-bold">Subscription</h2>
              <dl className="mt-5 space-y-4 text-sm">
                <div className="flex justify-between gap-4 border-b border-white/10 pb-3"><dt className="text-slate-400">Plan</dt><dd className="font-medium">{plan?.name || 'Not assigned'}</dd></div>
                <div className="flex justify-between gap-4 border-b border-white/10 pb-3"><dt className="text-slate-400">Status</dt><dd className="font-medium capitalize">{workspace.access.status.replaceAll('_', ' ')}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-slate-400">Trial end</dt><dd className="font-medium">{formatTrialDate(workspace.access.trialEndsAt)}</dd></div>
              </dl>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  )
}
