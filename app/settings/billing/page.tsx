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

function statusLabel(value?: string | null) {
  if (!value) return 'Access pending'
  if (value === 'platform_admin') return 'Platform admin'
  if (value === 'member_full_access') return 'Full access override'
  if (value === 'trialing') return '7-day full-access trial'
  if (value === 'trial_expired') return 'Trial ended — payment required'
  if (value === 'past_due') return 'Payment past due'
  if (value === 'manually_granted') return 'Manual/admin access'
  return value.replaceAll('_', ' ')
}

function daysLeft(value?: string | null) {
  if (!value) return null
  const diff = new Date(value).getTime() - Date.now()
  if (!Number.isFinite(diff)) return null
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)))
}

export default async function BillingSettingsPage() {
  const workspace = await getCurrentWorkspace()
  const plan = workspace.access.plan
  const enabledFeatures = Object.entries(workspace.access.features).filter(([, enabled]) => enabled)
  const limits = Object.entries(workspace.access.limits || {})
  const remaining = daysLeft(workspace.access.trialEndsAt)

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
      <div className="space-y-6">
        <section className={`rounded-3xl border p-8 ${workspace.access.requiresPayment ? 'border-amber-400/30 bg-amber-400/10' : 'border-white/10 bg-white/[0.03]'}`}>
          <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Plan & Billing</div>
          <h1 className="mt-2 text-3xl font-bold">{statusLabel(workspace.access.status)}</h1>
          <p className="mt-3 max-w-3xl text-slate-300">
            {workspace.access.isPlatformAdmin
              ? 'You are a platform admin. Admin access is not trial-based and does not require a subscription.'
              : workspace.access.status === 'trialing'
                ? `Your 7-day full-access trial is active${remaining !== null ? ` with ${remaining} day${remaining === 1 ? '' : 's'} left` : ''}. After that, the workspace is restricted until a subscription is active or admin grants an override.`
                : workspace.access.requiresPayment
                  ? workspace.access.restrictionReason || 'A valid subscription or admin override is required to continue using the workspace.'
                  : 'Your workspace currently has usable subscription or manual access.'}
          </p>
        </section>

        <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
          <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-8">
            <h2 className="text-xl font-bold">Payment status</h2>
            <dl className="mt-6 space-y-4 text-sm">
              <div className="flex justify-between gap-4 border-b border-white/10 pb-3">
                <dt className="text-slate-400">Plan</dt>
                <dd className="font-semibold">{plan?.name || (workspace.access.isPlatformAdmin ? 'Admin access' : 'No plan assigned')}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-white/10 pb-3">
                <dt className="text-slate-400">Status</dt>
                <dd className="font-semibold capitalize">{statusLabel(workspace.access.status)}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-white/10 pb-3">
                <dt className="text-slate-400">Trial ends</dt>
                <dd className="font-semibold">{formatDate(workspace.access.trialEndsAt)}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-white/10 pb-3">
                <dt className="text-slate-400">Current period ends</dt>
                <dd className="font-semibold">{formatDate(workspace.access.subscription?.current_period_end)}</dd>
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

            {workspace.access.requiresPayment ? (
              <div className="mt-6 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
                Your workspace needs an active subscription to unlock premium tools. Self-serve checkout can be connected to Stripe before launch; until then, platform admin can activate a subscription or grant a member override. For help, contact <a href="mailto:support@dealfloowiq.com" className="font-black text-white hover:underline">support@dealfloowiq.com</a>.
              </div>
            ) : null}
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-8">
            <h2 className="text-xl font-bold">Included access</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {enabledFeatures.map(([feature]) => (
                <div key={feature} className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 text-sm">
                  {featureLabels[feature as keyof typeof featureLabels] || feature}
                </div>
              ))}
              {!enabledFeatures.length ? <p className="text-sm text-slate-400">No deal tools are enabled while the workspace is restricted.</p> : null}
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
      </div>
    </AppShell>
  )
}
