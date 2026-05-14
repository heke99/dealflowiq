import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { canUseFeature, featureLabels, type FeatureKey } from '@/lib/billing/features'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getAccountTypeConfig } from '@/lib/product/accountTypes'

const featureGroups: Record<string, FeatureKey[]> = {
  landlord: ['deals', 'market_search', 'rent_analysis', 'market_rent', 'section8_hud', 'lender_view'],
  wholesaler: ['deals', 'market_search', 'calculators', 'wholesale', 'buyers', 'buyer_matching'],
  community: ['deals', 'market_search', 'community_members', 'buyers', 'buyer_matching', 'white_label'],
  investor: ['deals', 'market_search', 'rent_analysis', 'calculators', 'brrrr', 'five_year_projection'],
}

function getDashboardFeatures(accountType: string, availableFeatures: Record<string, boolean | undefined>) {
  const key = accountType === 'landlord' || accountType === 'section_8_landlord'
    ? 'landlord'
    : accountType === 'wholesaler'
      ? 'wholesaler'
      : accountType === 'community_guru_owner'
        ? 'community'
        : 'investor'

  return featureGroups[key].map((feature) => ({
    feature,
    label: featureLabels[feature],
    enabled: Boolean(availableFeatures[feature]),
  }))
}

function formatMoney(cents?: number | null, currency = 'usd') {
  if (!cents) return '$0'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: 0 }).format(cents / 100)
}

function formatTrialDate(value?: string | null) {
  if (!value) return 'No trial date set'
  return new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(value))
}

export default async function DashboardPage() {
  const workspace = await getCurrentWorkspace()
  const accountType = workspace.access.accountType
  const config = getAccountTypeConfig(accountType)
  const dashboardFeatures = getDashboardFeatures(accountType, workspace.access.features)
  const plan = workspace.access.plan
  const supabase = await createSupabaseServerClient()

  const [{ count: dealsCount }, { count: marketCount }, { data: topScores }, { data: latestJobs }] = workspace.organization?.id
    ? await Promise.all([
        supabase.from('deals').select('id', { count: 'exact', head: true }).eq('organization_id', workspace.organization.id),
        supabase.from('market_listings').select('id', { count: 'exact', head: true }).or(`organization_id.eq.${workspace.organization.id},visibility.eq.public`),
        supabase.from('market_listing_scores').select('deal_score, risk_level, market_listings!inner(id, organization_id, visibility)').or(`market_listings.organization_id.eq.${workspace.organization.id},market_listings.visibility.eq.public`).order('deal_score', { ascending: false }).limit(8),
        supabase.from('market_import_jobs').select('status, items_created, items_updated, items_failed, created_at, error_message').eq('organization_id', workspace.organization.id).order('created_at', { ascending: false }).limit(5),
      ])
    : [{ count: 0 }, { count: 0 }, { data: [] }, { data: [] }]

  const opportunityCount = (topScores || []).filter((row: any) => Number(row.deal_score || 0) >= 80).length
  const latestFailedJob = (latestJobs || []).find((job: any) => job.status === 'failed')

  const stats = [
    { label: accountType === 'landlord' || accountType === 'section_8_landlord' ? 'Properties' : 'My Deals', value: String(dealsCount || 0), hint: 'Private/team deals in your workspace.' },
    { label: 'Market Listings', value: String(marketCount || 0), hint: 'Imported, public and team-visible listings.' },
    { label: 'Opportunities 80+', value: String(opportunityCount || 0), hint: 'High-rated listings ready for review.' },
    { label: 'Current Plan', value: plan?.name || 'Trial', hint: workspace.access.status },
  ]

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
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-medium uppercase tracking-wide text-slate-500">DealFlowIQ Workspace</div>
              <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{config.title} dashboard</h1>
              <p className="mt-3 max-w-3xl text-slate-300">
                Your account type personalizes the dashboard and recommendations. Core modules are available to everyone; subscription plans control premium access and usage limits.
              </p>
              {workspace.error ? (
                <div className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
                  Supabase setup issue: {workspace.error}
                </div>
              ) : null}
            </div>
            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
              <Link href="/market?tab=opportunities" className="rounded-xl bg-white px-5 py-3 text-center font-semibold text-slate-950 transition hover:bg-slate-200">
                Open Opportunities
              </Link>
              <Link href="/market?tab=sources" className="rounded-xl border border-white/10 px-5 py-3 text-center font-semibold text-slate-100 transition hover:bg-white/10">
                Manage Sources
              </Link>
              <Link href="/deals" className="rounded-xl border border-white/10 px-5 py-3 text-center font-semibold text-slate-100 transition hover:bg-white/10">
                My Deals
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map((item) => (
            <div key={item.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <div className="text-sm text-slate-400">{item.label}</div>
              <div className="mt-3 text-2xl font-bold">{item.value}</div>
              <div className="mt-3 text-xs text-slate-500">{item.hint}</div>
            </div>
          ))}
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-xl font-bold">Recommended modules</h2>
            <p className="mt-2 text-sm text-slate-400">Account type changes the recommendation order. Plans decide which premium modules are unlocked.</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {dashboardFeatures.map((item) => (
                <div key={item.feature} className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                  <div className="text-sm font-semibold">{item.label}</div>
                  <div className={item.enabled ? 'mt-2 text-xs text-emerald-300' : 'mt-2 text-xs text-slate-500'}>
                    {item.enabled ? 'Enabled' : 'Premium / upgrade'}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-xl font-bold">Market engine</h2>
            <p className="mt-2 text-sm text-slate-400">Track automated source imports and the strongest scored opportunities.</p>
            <div className="mt-5 space-y-3">
              {(topScores || []).slice(0, 3).map((score: any, index: number) => (
                <div key={`${score.deal_score}-${index}`} className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-100">Opportunity #{index + 1}</div>
                    <div className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-bold text-emerald-100">{Math.round(Number(score.deal_score || 0))}</div>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">Risk: {String(score.risk_level || 'medium')}</div>
                </div>
              ))}
              {!(topScores || []).length ? <div className="rounded-2xl border border-dashed border-white/15 p-4 text-sm text-slate-500">No scored opportunities yet. Add a Market source or publish a deal.</div> : null}
              {latestFailedJob ? <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-xs text-red-100">Latest import issue: {latestFailedJob.error_message || 'Import failed'}</div> : null}
            </div>
            <Link href="/market" className="mt-5 inline-flex rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-200">Go to Market</Link>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-xl font-bold">Subscription foundation</h2>
            <dl className="mt-5 space-y-4 text-sm">
              <div className="flex justify-between gap-4 border-b border-white/10 pb-3">
                <dt className="text-slate-400">Plan</dt>
                <dd className="font-medium">{plan?.name || 'Not assigned'}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-white/10 pb-3">
                <dt className="text-slate-400">Status</dt>
                <dd className="font-medium capitalize">{workspace.access.status.replaceAll('_', ' ')}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-white/10 pb-3">
                <dt className="text-slate-400">Trial end</dt>
                <dd className="font-medium">{formatTrialDate(workspace.access.trialEndsAt)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-400">Admin</dt>
                <dd className="font-medium">{workspace.access.isPlatformAdmin ? 'Platform admin' : 'Workspace user'}</dd>
              </div>
            </dl>
          </div>
        </section>
      </div>
    </AppShell>
  )
}
