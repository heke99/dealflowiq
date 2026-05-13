import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { featureLabels } from '@/lib/billing/features'

function formatMoney(cents?: number | null, currency = 'usd') {
  if (!cents) return '$0'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: 0 }).format(cents / 100)
}

function formatDate(value?: string | null) {
  if (!value) return 'Not set'
  return new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(value))
}

export default async function BillingSettingsPage() {
  const workspace = await getCurrentWorkspace()
  const plan = workspace.access.plan
  const enabledFeatures = Object.entries(workspace.access.features).filter(([, enabled]) => enabled)
  const limits = Object.entries(workspace.access.limits || {})

  return (
    <AppShell
      organizationName={workspace.organization?.name}
      userEmail={workspace.user.email}
      accountType={workspace.access.accountType}
      features={workspace.access.features}
      subscriptionStatus={workspace.access.status}
      planName={plan?.name}
      trialEndsAt={workspace.access.trialEndsAt}
      isPlatformAdmin={workspace.access.isPlatformAdmin}
    >
      <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-8">
          <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Plan & Billing</div>
          <h1 className="mt-2 text-3xl font-bold">{plan?.name || 'No plan assigned'}</h1>
          <p className="mt-3 text-slate-300">Internal plan/trial access is now active. Stripe billing will connect later.</p>

          <dl className="mt-6 space-y-4 text-sm">
            <div className="flex justify-between gap-4 border-b border-white/10 pb-3">
              <dt className="text-slate-400">Status</dt>
              <dd className="font-semibold capitalize">{workspace.access.status.replaceAll('_', ' ')}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-white/10 pb-3">
              <dt className="text-slate-400">Trial ends</dt>
              <dd className="font-semibold">{formatDate(workspace.access.trialEndsAt)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-white/10 pb-3">
              <dt className="text-slate-400">Monthly</dt>
              <dd className="font-semibold">{formatMoney(plan?.monthly_price_cents, plan?.currency)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-400">Annual</dt>
              <dd className="font-semibold">{formatMoney(plan?.annual_price_cents, plan?.currency)}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-8">
          <h2 className="text-xl font-bold">Included access</h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {enabledFeatures.map(([feature]) => (
              <div key={feature} className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 text-sm">
                {featureLabels[feature as keyof typeof featureLabels] || feature}
              </div>
            ))}
          </div>

          <h2 className="mt-8 text-xl font-bold">Usage limits</h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {limits.length ? limits.map(([key, value]) => (
              <div key={key} className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 text-sm">
                <div className="text-slate-400">{key.replaceAll('_', ' ')}</div>
                <div className="mt-1 text-lg font-semibold">{value === null ? 'Unlimited' : String(value)}</div>
              </div>
            )) : <p className="text-sm text-slate-400">No limits configured.</p>}
          </div>
        </section>
      </div>
    </AppShell>
  )
}
