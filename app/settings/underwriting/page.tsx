import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { hasOrganizationRole, MANAGEMENT_ROLES } from '@/lib/auth/access'
import { getOrganizationUnderwritingDefaults } from '@/lib/underwriting/defaults'
import { saveUnderwritingDefaultsAction } from '@/app/settings/underwriting/actions'

function Field({ label, name, defaultValue, hint, step = '0.01' }: { label: string; name: string; defaultValue: number; hint?: string; step?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <input
        name={name}
        type="number"
        step={step}
        defaultValue={defaultValue}
        className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-white/30"
      />
      {hint ? <span className="mt-1 block text-xs text-slate-600">{hint}</span> : null}
    </label>
  )
}

export default async function UnderwritingDefaultsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams
  const workspace = await getCurrentWorkspace()
  const defaults = await getOrganizationUnderwritingDefaults(workspace.organization?.id)
  const canEdit = hasOrganizationRole(workspace, MANAGEMENT_ROLES)

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
      <div className="space-y-6">
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-8">
          <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Workspace settings</div>
          <h1 className="mt-2 text-3xl font-bold">Underwriting defaults</h1>
          <p className="mt-3 max-w-3xl text-slate-400">
            These assumptions prefill new deals and drive scoring when a deal does not set its own values. Changing them here does not rewrite existing deals.
          </p>
        </section>

        {query?.saved ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">Defaults saved.</div> : null}
        {query?.error ? <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">{String(query.error)}</div> : null}
        {!canEdit ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
            You can view these defaults, but only workspace owners and admins can change them.
          </div>
        ) : null}

        <form action={saveUnderwritingDefaultsAction} className="space-y-6">
          <fieldset disabled={!canEdit} className="space-y-6 disabled:opacity-60">
            <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xl font-bold">Operating assumptions</h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Vacancy %" name="vacancy_percent" defaultValue={defaults.vacancy_percent} />
                <Field label="Management %" name="management_percent" defaultValue={defaults.management_percent} />
                <Field label="CapEx / month" name="capex_monthly" defaultValue={defaults.capex_monthly} />
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xl font-bold">Financing</h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Down payment %" name="down_payment_percent" defaultValue={defaults.down_payment_percent} />
                <Field label="Interest rate %" name="interest_rate_percent" defaultValue={defaults.interest_rate_percent} />
                <Field label="Loan term (months)" name="loan_term_months" defaultValue={defaults.loan_term_months} step="1" />
                <Field label="DSCR minimum" name="dscr_min_threshold" defaultValue={defaults.dscr_min_threshold} />
              </div>
              <label className="mt-4 block max-w-xs">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Cap rate basis</span>
                <select name="cap_rate_basis" defaultValue={defaults.cap_rate_basis} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-white/30">
                  <option value="purchase_price">Purchase price</option>
                  <option value="arv">ARV</option>
                  <option value="custom_value">Custom value</option>
                </select>
              </label>
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xl font-bold">Strategy assumptions</h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Wholesale MAO %" name="mao_percentage" defaultValue={defaults.mao_percentage} hint="Maximum allowable offer as % of ARV." />
                <Field label="Desired wholesale fee" name="desired_wholesale_fee" defaultValue={defaults.desired_wholesale_fee} />
                <Field label="Selling costs %" name="selling_costs_percent" defaultValue={defaults.selling_costs_percent} />
                <Field label="Holding costs / month" name="holding_costs_monthly" defaultValue={defaults.holding_costs_monthly} />
                <Field label="Refinance LTV %" name="refinance_ltv_percent" defaultValue={defaults.refinance_ltv_percent} hint="Used for BRRRR refinance modeling." />
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xl font-bold">Projection assumptions</h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Rent growth % / year" name="rent_growth_percent" defaultValue={defaults.rent_growth_percent} />
                <Field label="Expense growth % / year" name="expense_growth_percent" defaultValue={defaults.expense_growth_percent} />
                <Field label="Exit cap rate %" name="exit_cap_rate_percent" defaultValue={defaults.exit_cap_rate_percent} />
              </div>
            </section>

            <div className="flex flex-wrap gap-3">
              <button className="rounded-2xl bg-white px-6 py-3 text-sm font-black text-slate-950 hover:bg-slate-200">Save defaults</button>
              <Link href="/settings" className="rounded-2xl border border-white/10 px-6 py-3 text-sm font-bold text-slate-300 hover:bg-white/10">Back to settings</Link>
            </div>
          </fieldset>
        </form>
      </div>
    </AppShell>
  )
}
