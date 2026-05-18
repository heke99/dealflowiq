import { ArrowRight, BadgeDollarSign, Building2, CheckCircle2, RotateCw, Trash2 } from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { savePlanAction, deletePlanAction, syncPlanStripeAction, syncOrganizationSubscriptionAction, cancelOrganizationSubscriptionAction, deleteOrganizationSubscriptionAction } from './actions'
import { ACCOUNT_TYPE_CONFIGS } from '@/lib/product/accountTypes'
import { FEATURE_KEYS, featureLabels } from '@/lib/billing/features'

type AdminPlansPageProps = {
  searchParams?: Promise<{ error?: string; saved?: string }> | { error?: string; saved?: string }
}

type Row = Record<string, any>

const statusOptions = [
  ['active', 'Active'],
  ['manually_granted', 'Manual access'],
  ['comped', 'Comped'],
  ['past_due', 'Past due'],
  ['canceled', 'Canceled'],
  ['expired', 'Expired'],
]

function dollars(cents: number | null | undefined) {
  return ((cents || 0) / 100).toFixed(2).replace(/\.00$/, '')
}

function money(cents: number | null | undefined) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: Number(cents || 0) % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(Number(cents || 0) / 100)
}

function shortId(value?: string | null) {
  if (!value) return 'not synced'
  return `${value.slice(0, 10)}…${value.slice(-4)}`
}

function numberText(value: number | null | undefined) {
  return new Intl.NumberFormat('en-US').format(Number(value || 0))
}

function dateText(value?: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
}

function asObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {} as Record<string, unknown>
  return value as Record<string, unknown>
}

function statusLabel(value?: string | null) {
  if (!value || value === 'trialing') return 'active'
  return String(value).replaceAll('_', ' ')
}

function LimitFields({ limits }: { limits?: Record<string, unknown> }) {
  const values = limits || {}
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <label className="block text-sm"><span className="text-slate-300">Max deals</span><input name="max_deals" type="number" min="0" defaultValue={Number(values.max_deals ?? 25)} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
      <label className="block text-sm"><span className="text-slate-300">Max buyers</span><input name="max_buyers" type="number" min="0" defaultValue={Number(values.max_buyers ?? 0)} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
      <label className="block text-sm"><span className="text-slate-300">Team members</span><input name="max_team_members" type="number" min="0" defaultValue={Number(values.max_team_members ?? 1)} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
      <label className="block text-sm"><span className="text-slate-300">HUD lookups</span><input name="max_hud_lookups" type="number" min="0" defaultValue={Number(values.max_hud_lookups ?? 100)} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
      <label className="block text-sm"><span className="text-slate-300">AI reviews</span><input name="max_ai_reviews" type="number" min="0" defaultValue={Number(values.max_ai_reviews ?? 0)} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
      <label className="block text-sm"><span className="text-slate-300">Deal pages</span><input name="max_deal_landing_pages" type="number" min="0" defaultValue={Number(values.max_deal_landing_pages ?? 5)} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
      <label className="block text-sm"><span className="text-slate-300">Community members</span><input name="max_community_members" type="number" min="0" defaultValue={Number(values.max_community_members ?? 0)} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
      <label className="block text-sm"><span className="text-slate-300">Imports / month</span><input name="max_imports_per_month" type="number" min="0" defaultValue={Number(values.max_imports_per_month ?? 100)} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
      <label className="block text-sm"><span className="text-slate-300">Free imports / 7 days</span><input name="max_imports_per_7_days" type="number" min="0" defaultValue={Number(values.max_imports_per_7_days ?? 1)} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
      <label className="block text-sm"><span className="text-slate-300">Visible opportunities</span><input name="max_visible_opportunities" type="number" min="0" defaultValue={Number(values.max_visible_opportunities ?? 2)} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
      <label className="block text-sm"><span className="text-slate-300">Detail cooldown hours</span><input name="opportunity_detail_cooldown_hours" type="number" min="0" defaultValue={Number(values.opportunity_detail_cooldown_hours ?? 48)} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
    </div>
  )
}

function AccountTypeFields({ selected }: { selected?: string[] }) {
  const selectedSet = new Set(selected || [])
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {ACCOUNT_TYPE_CONFIGS.map((item) => (
        <label key={item.value} className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm">
          <input name={`account_${item.value}`} type="checkbox" defaultChecked={selectedSet.has(item.value)} /> {item.title}
        </label>
      ))}
    </div>
  )
}

function FeatureFields({ features }: { features?: Record<string, unknown> }) {
  const values = features || {}
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {FEATURE_KEYS.filter((feature) => feature !== 'admin_plan_management').map((feature) => (
        <label key={feature} className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm">
          <input name={`feature_${feature}`} type="checkbox" defaultChecked={Boolean(values[feature])} /> {featureLabels[feature]}
        </label>
      ))}
    </div>
  )
}

function PlanForm({ plan }: { plan?: Row }) {
  const features = asObject(plan?.features)
  const limits = asObject(plan?.limits)
  const accountTypes = Array.isArray(plan?.account_types) ? plan?.account_types as string[] : []
  return (
    <form action={savePlanAction} className="space-y-5">
      <input type="hidden" name="id" value={plan?.id || ''} />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-slate-300">Plan name</span>
          <input name="name" defaultValue={plan?.name || ''} required className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 outline-none focus:border-white/30" placeholder="Pro Investor" />
        </label>
        <label className="block text-sm">
          <span className="text-slate-300">Plan code</span>
          <input name="code" defaultValue={plan?.code || ''} required className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 outline-none focus:border-white/30" placeholder="pro_investor" />
        </label>
      </div>

      <label className="block text-sm">
        <span className="text-slate-300">Description</span>
        <textarea name="description" rows={3} defaultValue={plan?.description || ''} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 outline-none focus:border-white/30" placeholder="What this plan is for." />
      </label>

      <div className="grid gap-4 sm:grid-cols-4">
        <label className="block text-sm"><span className="text-slate-300">Monthly $</span><input name="monthly_price" type="number" min="0" step="0.01" defaultValue={plan ? dollars(plan.monthly_price_cents) : '12.99'} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
        <label className="block text-sm"><span className="text-slate-300">Annual $</span><input name="annual_price" type="number" min="0" step="0.01" defaultValue={plan ? dollars(plan.annual_price_cents) : '150'} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
        <label className="block text-sm"><span className="text-slate-300">Currency</span><input name="currency" defaultValue={plan?.currency || 'usd'} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
        <label className="block text-sm"><span className="text-slate-300">Order</span><input name="display_order" type="number" min="0" defaultValue={Number(plan?.display_order ?? 100)} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm"><input name="is_public" type="checkbox" defaultChecked={plan ? Boolean(plan.is_public) : true} /> Visible on signup/default selection</label>
        <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm"><input name="is_active" type="checkbox" defaultChecked={plan ? Boolean(plan.is_active) : true} /> Active plan</label>
      </div>

      <div>
        <div className="text-sm font-semibold">Account types this plan fits</div>
        <div className="mt-3"><AccountTypeFields selected={accountTypes} /></div>
      </div>

      <div>
        <div className="text-sm font-semibold">Included features</div>
        <div className="mt-3"><FeatureFields features={features} /></div>
      </div>

      <div>
        <div className="text-sm font-semibold">Plan limits</div>
        <div className="mt-3"><LimitFields limits={limits} /></div>
      </div>

      <button className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 font-black text-slate-950 hover:bg-slate-200">
        {plan ? 'Save plan changes' : 'Create plan'}
        <ArrowRight className="h-4 w-4" />
      </button>
    </form>
  )
}

export default async function AdminPlansPage({ searchParams }: AdminPlansPageProps) {
  const params = await Promise.resolve(searchParams || {})
  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()

  if (!workspace.access.isPlatformAdmin) {
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
        <div className="rounded-3xl border border-amber-500/30 bg-amber-500/10 p-8 text-amber-100">
          <div className="text-sm font-semibold uppercase tracking-wide">Platform admin required</div>
          <h1 className="mt-2 text-3xl font-bold">Plans & Subscriptions</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6">Only platform admins can manage plan and subscription records.</p>
        </div>
      </AppShell>
    )
  }

  const [plansResult, organizationsResult, subscriptionsResult, planUseResult] = await Promise.all([
    supabase.from('billing_plans').select('*').order('display_order', { ascending: true }),
    supabase.from('organizations').select('id, name, slug').order('name', { ascending: true }).limit(200),
    supabase.from('organization_subscriptions').select('id, organization_id, plan_id, status, current_period_start, current_period_end, notes, updated_at, stripe_customer_id, stripe_subscription_id, stripe_price_id, stripe_interval, stripe_cancel_at_period_end, organizations(id, name, slug), billing_plans(id, name, code, monthly_price_cents)').order('updated_at', { ascending: false }).limit(40),
    supabase.from('organization_subscriptions').select('id, plan_id'),
  ])

  const plans = (plansResult.data || []) as Row[]
  const organizations = (organizationsResult.data || []) as Row[]
  const subscriptions = (subscriptionsResult.data || []) as Row[]
  const planUseCounts = new Map<string, number>()
  for (const sub of (planUseResult.data || []) as Row[]) {
    if (sub.plan_id) planUseCounts.set(String(sub.plan_id), (planUseCounts.get(String(sub.plan_id)) || 0) + 1)
  }
  const activePlans = plans.filter((plan) => plan.is_active).length
  const activeSubs = subscriptions.filter((sub) => ['active', 'trialing', 'manually_granted', 'comped'].includes(String(sub.status))).length

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
        <section className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-blue-500/15 via-slate-950 to-emerald-500/10 p-6 sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-400/10 px-4 py-2 text-sm font-black uppercase tracking-wide text-blue-100">
                <BadgeDollarSign className="h-4 w-4" />
                Platform Admin
              </div>
              <h1 className="mt-4 text-4xl font-black tracking-tight">Plans & Subscriptions</h1>
              <p className="mt-3 max-w-3xl text-slate-300">Create plans, edit limits, delete plans safely, and sync organization subscriptions from one place. Trial language is removed from the product flow; access is active/manual/comped/canceled.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[520px]">
              <div className="rounded-3xl border border-white/10 bg-slate-950/50 p-4"><div className="text-xs text-slate-500">Plans</div><div className="mt-1 text-3xl font-black">{numberText(plans.length)}</div><div className="text-xs text-slate-500">{numberText(activePlans)} active</div></div>
              <div className="rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-4"><div className="text-xs text-emerald-100/70">Active access</div><div className="mt-1 text-3xl font-black text-emerald-100">{numberText(activeSubs)}</div><div className="text-xs text-emerald-100/70">Latest 40 shown</div></div>
              <div className="rounded-3xl border border-white/10 bg-slate-950/50 p-4"><div className="text-xs text-slate-500">Organizations</div><div className="mt-1 text-3xl font-black">{numberText(organizations.length)}</div><div className="text-xs text-slate-500">Selectable below</div></div>
            </div>
          </div>
          {params.error ? <div className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">{decodeURIComponent(params.error)}</div> : null}
          {params.saved ? <div className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">Saved and synced.</div> : null}
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-6">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-slate-950/60 text-emerald-100"><CheckCircle2 className="h-5 w-5" /></div>
              <div>
                <h2 className="text-xl font-black">Create new plan</h2>
                <p className="mt-2 text-sm text-slate-400">New plans are active access plans by default. No free-trial wording is shown to users.</p>
              </div>
            </div>
            <div className="mt-6"><PlanForm /></div>
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-6">
              <h2 className="text-xl font-black">Existing plans</h2>
              <p className="mt-2 text-sm text-slate-400">Open a plan to edit it. Deleting a plan that has subscriptions requires choosing a replacement so organizations stay synced.</p>
              <div className="mt-5 space-y-4">
                {plans.map((plan) => {
                  const useCount = planUseCounts.get(String(plan.id)) || 0
                  return (
                    <details key={plan.id} className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                      <summary className="cursor-pointer list-none">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-black">{plan.name}</span>
                              <span className={`rounded-full border px-2 py-1 text-[10px] font-black uppercase ${plan.is_active ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100' : 'border-white/10 bg-white/5 text-slate-400'}`}>{plan.is_active ? 'active' : 'inactive'}</span>
                              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-bold uppercase text-slate-400">{useCount} orgs</span>
                            </div>
                            <div className="mt-1 text-xs text-slate-500">{plan.code} · {money(plan.monthly_price_cents)}/mo · {money(plan.annual_price_cents)}/yr</div>
                          </div>
                          <div className="text-right text-sm font-black text-slate-100">Edit</div>
                        </div>
                        {plan.description ? <p className="mt-3 text-sm leading-6 text-slate-400">{plan.description}</p> : null}
                      </summary>

                      <div className="mt-5 border-t border-white/10 pt-5">
                        <PlanForm plan={plan} />
                        <div className="mt-4 rounded-2xl border border-blue-400/20 bg-blue-400/10 p-4">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div className="text-sm">
                              <div className="font-black text-blue-100">Stripe sync</div>
                              <div className="mt-1 text-xs text-blue-100/75">Status: {plan.stripe_sync_status || 'pending'} · Product: {shortId(plan.stripe_product_id)} · Monthly: {shortId(plan.stripe_monthly_price_id)} · Yearly: {shortId(plan.stripe_annual_price_id)}</div>
                              {plan.stripe_last_error ? <div className="mt-2 rounded-xl border border-amber-400/20 bg-amber-400/10 p-2 text-xs text-amber-100">{plan.stripe_last_error}</div> : null}
                            </div>
                            <form action={syncPlanStripeAction}>
                              <input type="hidden" name="plan_id" value={plan.id} />
                              <button className="rounded-xl border border-blue-300/30 px-4 py-3 text-sm font-black text-blue-100 hover:bg-blue-400/10">Sync Stripe now</button>
                            </form>
                          </div>
                        </div>
                        <form action={deletePlanAction} className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
                          <input type="hidden" name="plan_id" value={plan.id} />
                          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                            <label className="block text-sm">
                              <span className="font-semibold text-red-100">Replacement plan when in use</span>
                              <select name="replacement_plan_id" defaultValue="" className="mt-2 w-full rounded-xl border border-red-500/20 bg-slate-950 px-4 py-3 text-slate-100">
                                <option value="">{useCount > 0 ? 'Required before delete' : 'Not needed'}</option>
                                {plans.filter((candidate) => candidate.id !== plan.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
                              </select>
                            </label>
                            <button className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-400/30 px-4 py-3 text-sm font-black text-red-100 hover:bg-red-500/10">
                              <Trash2 className="h-4 w-4" />
                              Delete plan
                            </button>
                          </div>
                        </form>
                      </div>
                    </details>
                  )
                })}
              </div>
            </div>
          </div>
        </section>

        <section id="subscriptions" className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
          <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-6">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-slate-950/60 text-blue-100"><RotateCw className="h-5 w-5" /></div>
              <div>
                <h2 className="text-xl font-black">Add / sync organization subscription</h2>
                <p className="mt-2 text-sm text-slate-400">Assign a plan to an organization and set the access status. This creates or updates the single subscription record for that workspace.</p>
              </div>
            </div>
            <form action={syncOrganizationSubscriptionAction} className="mt-6 space-y-5">
              <label className="block text-sm">
                <span className="text-slate-300">Organization</span>
                <select name="organization_id" required className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3">
                  <option value="">Select organization</option>
                  {organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
                </select>
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="text-slate-300">Plan</span>
                  <select name="plan_id" required className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3">
                    <option value="">Select plan</option>
                    {plans.filter((plan) => plan.is_active).map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="text-slate-300">Status</span>
                  <select name="status" defaultValue="active" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3">
                    {statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm"><span className="text-slate-300">Current period days</span><input name="period_days" type="number" min="0" defaultValue="30" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
                <label className="block text-sm"><span className="text-slate-300">Internal note</span><input name="notes" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" placeholder="Optional" /></label>
              </div>
              <button className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 font-black text-slate-950 hover:bg-slate-200">
                Sync subscription
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-black">Recent subscriptions</h2>
                <p className="mt-2 text-sm text-slate-400">Use quick actions to activate, switch plan, cancel or delete a subscription record.</p>
              </div>
              <Building2 className="h-5 w-5 text-slate-500" />
            </div>
            <div className="mt-5 space-y-4">
              {subscriptions.map((sub) => {
                const org = Array.isArray(sub.organizations) ? sub.organizations[0] : sub.organizations
                const plan = Array.isArray(sub.billing_plans) ? sub.billing_plans[0] : sub.billing_plans
                return (
                  <div key={sub.id} className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="font-black">{org?.name || sub.organization_id}</div>
                        <div className="mt-1 text-xs text-slate-500">{plan?.name || 'No plan'} · {statusLabel(sub.status)} · period ends {dateText(sub.current_period_end)}</div>
                        <div className="mt-1 text-xs text-slate-600">Org ID: {sub.organization_id}</div>
                        <div className="mt-1 text-xs text-slate-600">Stripe: {shortId(sub.stripe_subscription_id)} · {sub.stripe_interval || 'manual'} {sub.stripe_cancel_at_period_end ? '· cancels at period end' : ''}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <form action={syncOrganizationSubscriptionAction}>
                          <input type="hidden" name="organization_id" value={sub.organization_id} />
                          <input type="hidden" name="status" value="active" />
                          <input type="hidden" name="period_days" value="30" />
                          <select name="plan_id" defaultValue={sub.plan_id || ''} className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-100">
                            {plans.filter((candidate) => candidate.is_active).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
                          </select>
                          <button className="ml-2 rounded-xl border border-emerald-400/30 px-3 py-2 text-xs font-black text-emerald-100 hover:bg-emerald-400/10">Activate/sync</button>
                        </form>
                        <form action={cancelOrganizationSubscriptionAction}>
                          <input type="hidden" name="subscription_id" value={sub.id} />
                          <button className="rounded-xl border border-amber-400/30 px-3 py-2 text-xs font-black text-amber-100 hover:bg-amber-400/10">Cancel</button>
                        </form>
                        <form action={deleteOrganizationSubscriptionAction}>
                          <input type="hidden" name="subscription_id" value={sub.id} />
                          <button className="rounded-xl border border-red-400/30 px-3 py-2 text-xs font-black text-red-100 hover:bg-red-500/10">Delete record</button>
                        </form>
                      </div>
                    </div>
                    {sub.notes ? <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-400">{sub.notes}</div> : null}
                  </div>
                )
              })}
              {!subscriptions.length ? <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-slate-400">No organization subscriptions found.</div> : null}
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  )
}
