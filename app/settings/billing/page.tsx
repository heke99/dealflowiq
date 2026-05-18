import Link from 'next/link'
import { CreditCard, ExternalLink, ShieldCheck } from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { featureLabels } from '@/lib/billing/features'
import { openBillingPortalAction, startCheckoutAction } from './actions'

type BillingSettingsPageProps = {
  searchParams?: Promise<{ error?: string; checkout?: string }> | { error?: string; checkout?: string }
}

type Row = Record<string, any>

function formatMoney(cents?: number | null, currency = 'usd') {
  if (!cents) return '$0'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: Number(cents) % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(Number(cents) / 100)
}

function formatDate(value?: string | null) {
  if (!value) return 'Not set'
  return new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(value))
}

function statusLabel(value?: string | null) {
  if (!value) return 'Free access'
  if (value === 'platform_admin') return 'Platform admin'
  if (value === 'member_full_access') return 'Full access override'
  if (value === 'trialing') return 'Premium trial'
  if (value === 'past_due') return 'Payment past due'
  if (value === 'incomplete') return 'Payment setup incomplete'
  if (value === 'unpaid') return 'Payment unpaid'
  if (value === 'manually_granted') return 'Manual/admin access'
  return value.replaceAll('_', ' ')
}

function daysLeft(value?: string | null) {
  if (!value) return null
  const diff = new Date(value).getTime() - Date.now()
  if (!Number.isFinite(diff)) return null
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)))
}

function planHighlights(plan: Row) {
  if (plan.code === 'free') return ['2 opportunity listings', '1 full detail every 48h', 'Limited imports', 'Preview access']
  if (plan.code === 'community_owner') return ['Everything in Premium', 'Create/manage community', 'Invite by email/code', 'Community dashboard', 'Member analytics']
  return ['100 imports/month', 'Unlimited saved deals', 'Deal Score + calculators', 'DSCR/bank view', 'Market rent + exports']
}

export default async function BillingSettingsPage({ searchParams }: BillingSettingsPageProps) {
  const params = await Promise.resolve(searchParams || {})
  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()
  const plan = workspace.access.plan
  const enabledFeatures = Object.entries(workspace.access.features).filter(([, enabled]) => enabled)
  const limits = Object.entries(workspace.access.limits || {})
  const remaining = daysLeft(workspace.access.trialEndsAt)

  const { data: publicPlans } = await supabase
    .from('billing_plans')
    .select('id, code, name, description, currency, monthly_price_cents, annual_price_cents, limits, features, stripe_sync_status, stripe_monthly_price_id, stripe_annual_price_id')
    .eq('is_public', true)
    .eq('is_active', true)
    .in('code', ['free', 'premium', 'community_owner'])
    .order('display_order', { ascending: true })

  const plans = (publicPlans || []) as Row[]
  const stripeCustomerId = workspace.access.subscription?.stripe_customer_id || null

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
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Plan & Billing</div>
              <h1 className="mt-2 text-3xl font-bold capitalize">{statusLabel(workspace.access.status)}</h1>
              <p className="mt-3 max-w-3xl text-slate-300">
                {workspace.access.isPlatformAdmin
                  ? 'You are a platform admin. Admin access bypasses billing and plan limits.'
                  : workspace.access.status === 'trialing'
                    ? `Premium trial is active${remaining !== null ? ` with ${remaining} day${remaining === 1 ? '' : 's'} left` : ''}. After trial end, the workspace falls back to Free until a paid subscription is active.`
                    : workspace.access.requiresPayment
                      ? workspace.access.restrictionReason || 'Update billing to restore premium workspace features.'
                      : 'Your workspace has usable access. Manage billing below or switch plan when needed.'}
              </p>
            </div>
            {stripeCustomerId ? (
              <form action={openBillingPortalAction}>
                <button className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-black text-slate-950 hover:bg-slate-200">
                  Manage in Stripe <ExternalLink className="h-4 w-4" />
                </button>
              </form>
            ) : null}
          </div>
          {params.error ? <div className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">{decodeURIComponent(params.error)}</div> : null}
          {params.checkout === 'success' ? <div className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">Checkout completed. Stripe webhook will keep access synced.</div> : null}
          {params.checkout === 'free' ? <div className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">Free plan activated.</div> : null}
        </section>

        <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
          <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-8">
            <h2 className="flex items-center gap-2 text-xl font-bold"><CreditCard className="h-5 w-5" /> Current subscription</h2>
            <dl className="mt-6 space-y-4 text-sm">
              <div className="flex justify-between gap-4 border-b border-white/10 pb-3"><dt className="text-slate-400">Plan</dt><dd className="font-semibold">{plan?.name || (workspace.access.isPlatformAdmin ? 'Admin access' : 'Free')}</dd></div>
              <div className="flex justify-between gap-4 border-b border-white/10 pb-3"><dt className="text-slate-400">Status</dt><dd className="font-semibold capitalize">{statusLabel(workspace.access.status)}</dd></div>
              <div className="flex justify-between gap-4 border-b border-white/10 pb-3"><dt className="text-slate-400">Trial ends</dt><dd className="font-semibold">{formatDate(workspace.access.trialEndsAt)}</dd></div>
              <div className="flex justify-between gap-4 border-b border-white/10 pb-3"><dt className="text-slate-400">Current period ends</dt><dd className="font-semibold">{formatDate(workspace.access.subscription?.current_period_end)}</dd></div>
              <div className="flex justify-between gap-4 border-b border-white/10 pb-3"><dt className="text-slate-400">Monthly</dt><dd className="font-semibold">{formatMoney(plan?.monthly_price_cents, plan?.currency)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-400">Annual</dt><dd className="font-semibold">{formatMoney(plan?.annual_price_cents, plan?.currency)}</dd></div>
            </dl>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-8">
            <h2 className="flex items-center gap-2 text-xl font-bold"><ShieldCheck className="h-5 w-5" /> Included access</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {enabledFeatures.slice(0, 12).map(([feature]) => (
                <div key={feature} className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 text-sm">{featureLabels[feature as keyof typeof featureLabels] || feature}</div>
              ))}
              {!enabledFeatures.length ? <p className="text-sm text-slate-400">No premium tools are enabled while the workspace is restricted.</p> : null}
            </div>
            <h2 className="mt-8 text-xl font-bold">Usage limits</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {limits.slice(0, 8).map(([key, value]) => (
                <div key={key} className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 text-sm"><div className="text-slate-400">{key.replaceAll('_', ' ')}</div><div className="mt-1 text-lg font-semibold">{value === null ? 'Unlimited' : String(value)}</div></div>
              ))}
              {!limits.length ? <p className="text-sm text-slate-400">No limits configured.</p> : null}
            </div>
          </section>
        </div>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-8">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-black">Choose plan</h2>
              <p className="mt-2 text-sm text-slate-400">Stripe Checkout is used for paid monthly/yearly plans. Free activates directly.</p>
            </div>
            <Link href="/plans" className="text-sm font-black text-slate-200 hover:text-white">View public pricing</Link>
          </div>
          <div className="mt-6 grid gap-5 lg:grid-cols-3">
            {plans.map((billingPlan) => (
              <div key={billingPlan.id} className={`rounded-3xl border p-5 ${billingPlan.code === plan?.code ? 'border-emerald-400/40 bg-emerald-400/10' : 'border-white/10 bg-slate-950/50'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-black">{billingPlan.name}</h3>
                    <p className="mt-2 min-h-[64px] text-sm leading-6 text-slate-400">{billingPlan.description}</p>
                  </div>
                  {billingPlan.code === plan?.code ? <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-black text-emerald-100">Current</span> : null}
                </div>
                <div className="mt-5 text-3xl font-black">{formatMoney(billingPlan.monthly_price_cents, billingPlan.currency)}<span className="text-sm font-semibold text-slate-500">/mo</span></div>
                <div className="mt-1 text-sm text-slate-400">{formatMoney(billingPlan.annual_price_cents, billingPlan.currency)}/year</div>
                <ul className="mt-5 space-y-2 text-sm text-slate-300">
                  {planHighlights(billingPlan).map((item) => <li key={item}>✓ {item}</li>)}
                </ul>
                <div className="mt-5 grid gap-2">
                  <form action={startCheckoutAction}>
                    <input type="hidden" name="plan_id" value={billingPlan.id} />
                    <input type="hidden" name="interval" value="month" />
                    <button className="w-full rounded-xl bg-white px-4 py-3 text-sm font-black text-slate-950 hover:bg-slate-200">{Number(billingPlan.monthly_price_cents || 0) > 0 ? 'Checkout monthly' : 'Activate free'}</button>
                  </form>
                  {Number(billingPlan.annual_price_cents || 0) > 0 ? (
                    <form action={startCheckoutAction}>
                      <input type="hidden" name="plan_id" value={billingPlan.id} />
                      <input type="hidden" name="interval" value="year" />
                      <button className="w-full rounded-xl border border-white/10 px-4 py-3 text-sm font-black text-slate-100 hover:bg-white/10">Checkout yearly</button>
                    </form>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  )
}
