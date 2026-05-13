import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { savePlanAction, extendTrialAction } from './actions'
import { ACCOUNT_TYPE_CONFIGS } from '@/lib/product/accountTypes'
import { FEATURE_KEYS, featureLabels } from '@/lib/billing/features'

type AdminPlansPageProps = {
  searchParams?: Promise<{ error?: string; saved?: string }> | { error?: string; saved?: string }
}

function dollars(cents: number | null | undefined) {
  return ((cents || 0) / 100).toFixed(0)
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
          <h1 className="mt-2 text-3xl font-bold">Admin Plans</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6">
            This page is ready, but your user must be added to <code>public.platform_admins</code> first. After running the SQL migration, insert your auth user id into that table from Supabase.
          </p>
        </div>
      </AppShell>
    )
  }

  const { data: plans } = await supabase
    .from('billing_plans')
    .select('*')
    .order('display_order', { ascending: true })

  const { data: subscriptions } = await supabase
    .from('organization_subscriptions')
    .select('id, organization_id, status, trial_end_at, organizations(name), billing_plans(name, code)')
    .order('created_at', { ascending: false })
    .limit(12)


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
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-8">
          <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Platform Admin</div>
          <h1 className="mt-2 text-3xl font-bold">Plans, Trials & Feature Access</h1>
          <p className="mt-3 max-w-3xl text-slate-300">
            Manage what each plan includes before Stripe is connected. These settings already control feature visibility and trial access.
          </p>
          {params.error ? <div className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">{params.error}</div> : null}
          {params.saved ? <div className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">Saved.</div> : null}
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-xl font-bold">Create / Update plan</h2>
            <p className="mt-2 text-sm text-slate-400">Use the same code to update an existing plan, or leave ID empty to create a new one.</p>
            <form action={savePlanAction} className="mt-6 space-y-5">
              <input type="hidden" name="id" />
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="text-slate-300">Plan name</span>
                  <input name="name" defaultValue="" required className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 outline-none focus:border-white/30" placeholder="Pro Investor" />
                </label>
                <label className="block text-sm">
                  <span className="text-slate-300">Plan code</span>
                  <input name="code" defaultValue="" required className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 outline-none focus:border-white/30" placeholder="pro_investor" />
                </label>
              </div>

              <label className="block text-sm">
                <span className="text-slate-300">Description</span>
                <textarea name="description" rows={3} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 outline-none focus:border-white/30" placeholder="What this plan is for." />
              </label>

              <div className="grid gap-4 sm:grid-cols-4">
                <label className="block text-sm"><span className="text-slate-300">Monthly $</span><input name="monthly_price" type="number" min="0" defaultValue="49" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
                <label className="block text-sm"><span className="text-slate-300">Annual $</span><input name="annual_price" type="number" min="0" defaultValue="470" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
                <label className="block text-sm"><span className="text-slate-300">Trial days</span><input name="trial_days" type="number" min="0" defaultValue="7" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
                <label className="block text-sm"><span className="text-slate-300">Order</span><input name="display_order" type="number" min="0" defaultValue="100" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm"><input name="is_public" type="checkbox" defaultChecked /> Public plan</label>
                <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm"><input name="is_active" type="checkbox" defaultChecked /> Active plan</label>
              </div>

              <div>
                <div className="text-sm font-semibold">Account types this plan fits</div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {ACCOUNT_TYPE_CONFIGS.map((item) => (
                    <label key={item.value} className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm">
                      <input name={`account_${item.value}`} type="checkbox" /> {item.title}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-sm font-semibold">Included features</div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {FEATURE_KEYS.filter((feature) => feature !== 'admin_plan_management').map((feature) => (
                    <label key={feature} className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm">
                      <input name={`feature_${feature}`} type="checkbox" /> {featureLabels[feature]}
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block text-sm"><span className="text-slate-300">Max deals</span><input name="max_deals" type="number" min="0" defaultValue="25" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
                <label className="block text-sm"><span className="text-slate-300">Max buyers</span><input name="max_buyers" type="number" min="0" defaultValue="0" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
                <label className="block text-sm"><span className="text-slate-300">Team members</span><input name="max_team_members" type="number" min="0" defaultValue="1" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
                <label className="block text-sm"><span className="text-slate-300">HUD lookups</span><input name="max_hud_lookups" type="number" min="0" defaultValue="100" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
                <label className="block text-sm"><span className="text-slate-300">AI reviews</span><input name="max_ai_reviews" type="number" min="0" defaultValue="0" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
                <label className="block text-sm"><span className="text-slate-300">Deal pages</span><input name="max_deal_landing_pages" type="number" min="0" defaultValue="5" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
                <label className="block text-sm"><span className="text-slate-300">Community members</span><input name="max_community_members" type="number" min="0" defaultValue="0" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
              </div>

              <button className="w-full rounded-xl bg-white px-5 py-3 font-semibold text-slate-950 hover:bg-slate-200">Save plan</button>
            </form>
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xl font-bold">Existing plans</h2>
              <div className="mt-5 space-y-3">
                {(plans || []).map((plan: any) => (
                  <div key={plan.id} className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="font-semibold">{plan.name}</div>
                        <div className="mt-1 text-xs text-slate-500">{plan.code} · {plan.is_active ? 'active' : 'inactive'} · {plan.trial_days} trial days</div>
                      </div>
                      <div className="text-right text-sm font-semibold">${dollars(plan.monthly_price_cents)}/mo</div>
                    </div>
                    <p className="mt-3 text-sm text-slate-400">{plan.description}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xl font-bold">Extend trial manually</h2>
              <p className="mt-2 text-sm text-slate-400">Use this for specific companies/users you invite or approve manually.</p>
              <form action={extendTrialAction} className="mt-5 space-y-4">
                <input name="organization_id" className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm" placeholder="Organization ID" />
                <div className="grid gap-4 sm:grid-cols-2">
                  <input name="extra_days" type="number" min="0" defaultValue="7" className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm" />
                  <input name="note" className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm" placeholder="Note" />
                </div>
                <button className="w-full rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold hover:bg-white/10">Extend trial</button>
              </form>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xl font-bold">Recent subscriptions</h2>
              <div className="mt-5 space-y-3 text-sm">
                {(subscriptions || []).map((sub: any) => {
                  const org = Array.isArray(sub.organizations) ? sub.organizations[0] : sub.organizations
                  const plan = Array.isArray(sub.billing_plans) ? sub.billing_plans[0] : sub.billing_plans
                  return (
                    <div key={sub.id} className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                      <div className="font-semibold">{org?.name || sub.organization_id}</div>
                      <div className="mt-1 text-xs text-slate-500">{plan?.name || 'No plan'} · {sub.status} · org: {sub.organization_id}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  )
}
