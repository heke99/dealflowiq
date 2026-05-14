import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { FinancialSnapshot } from '@/components/deals/FinancialSnapshot'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { quickUpdateDealAssumptionsAction } from '@/app/deals/actions'


function QuickField({ label, name, defaultValue }: { label: string; name: string; defaultValue?: string | number | null }) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <input name={name} type="number" step="0.01" defaultValue={defaultValue ?? ''} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-white/30" />
    </label>
  )
}

export default async function DealAnalyzerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params
  const query = await searchParams
  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()

  const { data: deal } = workspace.organization?.id
    ? await supabase
        .from('deals')
        .select('*, properties(*)')
        .eq('id', id)
        .eq('organization_id', workspace.organization.id)
        .maybeSingle()
    : { data: null }

  if (!deal) notFound()

  const { data: snapshots } = workspace.organization?.id
    ? await supabase
        .from('deal_calculation_snapshots')
        .select('id, snapshot_name, formula_version, created_at, results')
        .eq('deal_id', id)
        .eq('organization_id', workspace.organization.id)
        .order('created_at', { ascending: false })
        .limit(10)
    : { data: [] }

  const property = Array.isArray((deal as any).properties) ? (deal as any).properties[0] : (deal as any).properties

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
        <section className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-8 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Deal Analyzer</div>
            <h1 className="mt-2 text-3xl font-bold">{(deal as any).title}</h1>
            <p className="mt-3 max-w-3xl text-slate-300">
              Live underwriting view for NOI, cap rate, DSCR, cashflow, rent gaps and early strategy previews.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href={`/deals/${id}/edit`} className="rounded-xl bg-white px-5 py-3 text-center font-semibold text-slate-950 transition hover:bg-slate-200">Edit Inputs</Link>
            <Link href={`/deals/${id}`} className="rounded-xl border border-white/10 px-5 py-3 text-center font-semibold text-slate-100 transition hover:bg-white/10">Back to Deal</Link>
          </div>
        </section>


        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Fast assumption update</div>
          <h2 className="mt-2 text-xl font-bold">Change key numbers and recalculate</h2>
          <form action={quickUpdateDealAssumptionsAction} className="mt-5 grid gap-4 md:grid-cols-3 xl:grid-cols-6">
            <input type="hidden" name="deal_id" value={id} />
            <input type="hidden" name="redirect_to" value={`/deals/${id}/analyzer`} />
            <QuickField label="Purchase price" name="purchase_price" defaultValue={(deal as any).purchase_price} />
            <QuickField label="Current rent" name="current_rent" defaultValue={(deal as any).current_rent} />
            <QuickField label="Market rent" name="market_rent" defaultValue={(deal as any).market_rent} />
            <QuickField label="HUD rent" name="section8_rent" defaultValue={(deal as any).section8_rent} />
            <QuickField label="Vacancy %" name="vacancy_percent" defaultValue={(deal as any).vacancy_percent} />
            <QuickField label="Management %" name="management_percent" defaultValue={(deal as any).management_percent} />
            <QuickField label="Down payment %" name="down_payment_percent" defaultValue={(deal as any).down_payment_percent} />
            <QuickField label="Interest %" name="interest_rate_percent" defaultValue={(deal as any).interest_rate_percent} />
            <QuickField label="Loan months" name="loan_term_months" defaultValue={(deal as any).loan_term_months} />
            <QuickField label="Taxes / year" name="taxes_annual" defaultValue={(deal as any).taxes_annual} />
            <QuickField label="Insurance / year" name="insurance_annual" defaultValue={(deal as any).insurance_annual} />
            <QuickField label="DSCR target" name="dscr_min_threshold" defaultValue={(deal as any).dscr_min_threshold} />
            <button className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-200 md:col-span-3 xl:col-span-6">Save and recalculate</button>
          </form>
        </section>

        <FinancialSnapshot
          deal={deal as any}
          property={property as any}
          showAnalyzerLink={false}
          showSnapshotTools
          snapshots={(snapshots || []) as any}
          message={query?.snapshot === 'saved' ? 'Calculation snapshot saved. Future assumption changes will not alter that saved analysis.' : query?.saved === 'assumptions' ? 'Inputs saved. The analyzer has been recalculated.' : null}
          error={query?.error ? String(query.error) : null}
        />
      </div>
    </AppShell>
  )
}
