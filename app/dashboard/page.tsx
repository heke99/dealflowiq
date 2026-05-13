import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { canUseFeature, featureLabels, type FeatureKey } from '@/lib/billing/features'
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

  const stats = [
    { label: accountType === 'landlord' || accountType === 'section_8_landlord' ? 'Properties' : 'Total Deals', value: '0', hint: 'Deal creation comes next.' },
    { label: 'Current Plan', value: plan?.name || 'Trial', hint: workspace.access.status },
    { label: 'Trial Ends', value: formatTrialDate(workspace.access.trialEndsAt), hint: workspace.access.isTrialActive ? 'Trial is active' : 'Trial not active' },
    { label: 'Monthly Price', value: formatMoney(plan?.monthly_price_cents, plan?.currency), hint: 'Stripe billing comes later.' },
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
              <Link href="/deals" className="rounded-xl bg-white px-5 py-3 text-center font-semibold text-slate-950 transition hover:bg-slate-200">
                Open Deals
              </Link>
              <Link href="/settings/billing" className="rounded-xl border border-white/10 px-5 py-3 text-center font-semibold text-slate-100 transition hover:bg-white/10">
                View Plan
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
