import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { FinancialSnapshot } from '@/components/deals/FinancialSnapshot'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { quickUpdateDealAssumptionsAction } from '@/app/deals/actions'
import { lookupHudRentAction, smartAnalyzeDealAction } from '@/app/deals/[id]/rent-intelligence/actions'
import { asRows, firstRow, type Row } from '@/lib/types/rows'


function QuickField({ label, name, defaultValue }: { label: string; name: string; defaultValue?: unknown }) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <input name={name} type="number" step="0.01" defaultValue={String(defaultValue ?? '')} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-white/30" />
    </label>
  )
}

export default async function DealAnalyzerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params
  const query = await searchParams
  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()

  const { data: dealData } = workspace.organization?.id
    ? await supabase
        .from('deals')
        .select('*, properties(*)')
        .eq('id', id)
        .eq('organization_id', workspace.organization.id)
        .maybeSingle()
    : { data: null }

  if (!dealData) notFound()
  const deal = dealData as Row

  const { data: snapshots } = workspace.organization?.id
    ? await supabase
        .from('deal_calculation_snapshots')
        .select('id, snapshot_name, formula_version, created_at, results')
        .eq('deal_id', id)
        .eq('organization_id', workspace.organization.id)
        .order('created_at', { ascending: false })
        .limit(10)
    : { data: [] }

  const property = firstRow(deal.properties)

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
            <h1 className="mt-2 text-3xl font-bold">{String(deal.title)}</h1>
            <p className="mt-3 max-w-3xl text-slate-300">
              Live underwriting view for NOI, cap rate, DSCR, cashflow, rent gaps and early strategy previews.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <form action={smartAnalyzeDealAction}>
              <input type="hidden" name="deal_id" value={id} />
              <input type="hidden" name="redirect_to" value={`/deals/${id}/analyzer`} />
              <button className="rounded-xl bg-emerald-300 px-5 py-3 text-center font-semibold text-slate-950 transition hover:bg-emerald-200">Smart analyze</button>
            </form>
            <form action={lookupHudRentAction}>
              <input type="hidden" name="deal_id" value={id} />
              <input type="hidden" name="redirect_to" value={`/deals/${id}/analyzer`} />
              <input type="hidden" name="zip_code" value={String(property?.zip_code || '')} />
              <input type="hidden" name="bedrooms" value={String(property?.bedrooms || '')} />
              <input type="hidden" name="hud_year" value="auto" />
              <button className="rounded-xl border border-white/10 px-5 py-3 text-center font-semibold text-slate-100 transition hover:bg-white/10">Search HUD rent</button>
            </form>
            <Link href={`/deals/${id}/edit`} className="rounded-xl border border-white/10 px-5 py-3 text-center font-semibold text-slate-100 transition hover:bg-white/10">Edit Inputs</Link>
            <Link href={`/deals/${id}`} className="rounded-xl border border-white/10 px-5 py-3 text-center font-semibold text-slate-100 transition hover:bg-white/10">Back to Deal</Link>
          </div>
        </section>


        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Fast assumption update</div>
          <h2 className="mt-2 text-xl font-bold">Change key numbers and recalculate</h2>
          <form action={quickUpdateDealAssumptionsAction} className="mt-5 grid gap-4 md:grid-cols-3 xl:grid-cols-6">
            <input type="hidden" name="deal_id" value={id} />
            <input type="hidden" name="redirect_to" value={`/deals/${id}/analyzer`} />
            <QuickField label="Purchase price" name="purchase_price" defaultValue={deal.purchase_price} />
            <QuickField label="Current rent" name="current_rent" defaultValue={deal.current_rent} />
            <QuickField label="Market rent" name="market_rent" defaultValue={deal.market_rent} />
            <QuickField label="HUD rent" name="section8_rent" defaultValue={deal.section8_rent} />
            <QuickField label="Vacancy %" name="vacancy_percent" defaultValue={deal.vacancy_percent} />
            <QuickField label="Management %" name="management_percent" defaultValue={deal.management_percent} />
            <QuickField label="Down payment %" name="down_payment_percent" defaultValue={deal.down_payment_percent} />
            <QuickField label="Interest %" name="interest_rate_percent" defaultValue={deal.interest_rate_percent} />
            <QuickField label="Loan months" name="loan_term_months" defaultValue={deal.loan_term_months} />
            <QuickField label="Taxes / year" name="taxes_annual" defaultValue={deal.taxes_annual} />
            <QuickField label="Insurance / year" name="insurance_annual" defaultValue={deal.insurance_annual} />
            <QuickField label="DSCR target" name="dscr_min_threshold" defaultValue={deal.dscr_min_threshold} />
            <button className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-200 md:col-span-3 xl:col-span-6">Save and recalculate</button>
          </form>
        </section>

        <FinancialSnapshot
          deal={deal}
          property={property}
          showAnalyzerLink={false}
          showSnapshotTools
          snapshots={asRows(snapshots)}
          message={query?.notice ? String(query.notice) : query?.snapshot === 'saved' ? 'Calculation snapshot saved. Future assumption changes will not alter that saved analysis.' : query?.saved === 'assumptions' ? 'Inputs saved. The analyzer has been recalculated.' : query?.saved === 'hud' ? 'HUD rent updated and analysis refreshed.' : query?.saved === 'smart' ? 'Smart analysis refreshed.' : null}
          error={query?.error ? String(query.error) : null}
        />
      </div>
    </AppShell>
  )
}
