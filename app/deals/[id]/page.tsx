import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { FinancialSnapshot } from '@/components/deals/FinancialSnapshot'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { quickUpdateDealAssumptionsAction } from '@/app/deals/actions'

function money(value: number | string | null | undefined) {
  const numberValue = Number(value || 0)
  if (!numberValue) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(numberValue)
}

function percent(value: number | string | null | undefined) {
  const numberValue = Number(value || 0)
  if (!numberValue) return '—'
  return `${numberValue}%`
}

function row(label: string, value: React.ReactNode) {
  return (
    <div className="flex justify-between gap-4 border-b border-white/10 py-3 last:border-b-0">
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-right font-medium text-slate-100">{value}</dd>
    </div>
  )
}

function QuickField({ label, name, defaultValue, placeholder }: { label: string; name: string; defaultValue?: string | number | null; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <input name={name} type="number" step="0.01" defaultValue={defaultValue ?? ''} placeholder={placeholder} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-white/30" />
    </label>
  )
}

export default async function DealDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
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

  const property = Array.isArray((deal as any).properties) ? (deal as any).properties[0] : (deal as any).properties
  const currentRent = Number((deal as any).current_rent || 0)
  const marketRent = Number((deal as any).market_rent || 0)
  const hudRent = Number((deal as any).section8_rent || 0)
  const rentGap = marketRent - currentRent
  const hudGap = hudRent - currentRent

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
            <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Deal Detail</div>
            <h1 className="mt-2 text-3xl font-bold">{(deal as any).title}</h1>
            <p className="mt-3 max-w-3xl text-slate-300">
              {[property?.address, property?.city, property?.state, property?.zip_code].filter(Boolean).join(', ') || 'No address entered yet'}
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium uppercase tracking-wide text-slate-400">
              <span className="rounded-full border border-white/10 px-3 py-1">{String((deal as any).status || 'draft').replaceAll('_', ' ')}</span>
              <span className="rounded-full border border-white/10 px-3 py-1">{(deal as any).property_type || 'Property type pending'}</span>
              <span className="rounded-full border border-white/10 px-3 py-1">{property?.number_of_units || 1} unit(s)</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href={`/deals/${id}/analyzer`} className="rounded-xl bg-white px-5 py-3 text-center font-semibold text-slate-950 transition hover:bg-slate-200">Analyze</Link>
            <Link href={`/deals/${id}/rent-intelligence`} className="rounded-xl border border-white/10 px-5 py-3 text-center font-semibold text-slate-100 transition hover:bg-white/10">Rent Intelligence</Link>
            <Link href={`/deals/${id}/edit`} className="rounded-xl border border-white/10 px-5 py-3 text-center font-semibold text-slate-100 transition hover:bg-white/10">Edit Deal</Link>
            <Link href="/deals" className="rounded-xl border border-white/10 px-5 py-3 text-center font-semibold text-slate-100 transition hover:bg-white/10">Back</Link>
          </div>
        </section>

        {query?.saved ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">Saved successfully.</div> : null}
        {query?.error ? <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">{String(query.error)}</div> : null}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="text-sm text-slate-400">Purchase Price</div>
            <div className="mt-3 text-2xl font-bold">{money((deal as any).purchase_price)}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="text-sm text-slate-400">ARV</div>
            <div className="mt-3 text-2xl font-bold">{money((deal as any).arv)}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="text-sm text-slate-400">Market Rent Gap</div>
            <div className={rentGap > 0 ? 'mt-3 text-2xl font-bold text-emerald-300' : 'mt-3 text-2xl font-bold'}>{rentGap ? money(rentGap) + '/mo' : '—'}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="text-sm text-slate-400">HUD Rent Gap</div>
            <div className={hudGap > 0 ? 'mt-3 text-2xl font-bold text-emerald-300' : 'mt-3 text-2xl font-bold'}>{hudGap ? money(hudGap) + '/mo' : '—'}</div>
          </div>
        </section>


        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Quick underwriting inputs</div>
              <h2 className="mt-2 text-xl font-bold">Fill the numbers needed for analysis</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                Use this fast form after creating a deal. It updates the deal without wiping fields you leave blank.
              </p>
            </div>
            <Link href={`/deals/${id}/edit`} className="rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-slate-100 hover:bg-white/10">Full edit</Link>
          </div>
          <form action={quickUpdateDealAssumptionsAction} className="mt-5 grid gap-4 md:grid-cols-3 xl:grid-cols-6">
            <input type="hidden" name="deal_id" value={id} />
            <input type="hidden" name="redirect_to" value={`/deals/${id}`} />
            <QuickField label="Purchase price" name="purchase_price" defaultValue={(deal as any).purchase_price} />
            <QuickField label="Current rent" name="current_rent" defaultValue={(deal as any).current_rent} />
            <QuickField label="Market rent" name="market_rent" defaultValue={(deal as any).market_rent} />
            <QuickField label="HUD rent" name="section8_rent" defaultValue={(deal as any).section8_rent} />
            <QuickField label="Taxes / year" name="taxes_annual" defaultValue={(deal as any).taxes_annual} />
            <QuickField label="Insurance / year" name="insurance_annual" defaultValue={(deal as any).insurance_annual} />
            <QuickField label="Vacancy %" name="vacancy_percent" defaultValue={(deal as any).vacancy_percent} />
            <QuickField label="Management %" name="management_percent" defaultValue={(deal as any).management_percent} />
            <QuickField label="Down payment %" name="down_payment_percent" defaultValue={(deal as any).down_payment_percent} />
            <QuickField label="Interest %" name="interest_rate_percent" defaultValue={(deal as any).interest_rate_percent} />
            <QuickField label="Loan months" name="loan_term_months" defaultValue={(deal as any).loan_term_months} />
            <QuickField label="DSCR target" name="dscr_min_threshold" defaultValue={(deal as any).dscr_min_threshold} />
            <button className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-200 md:col-span-3 xl:col-span-6">Update analysis inputs</button>
          </form>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-xl font-bold">Rent assumptions</h2>
            <dl className="mt-4 text-sm">
              {row('Current rent', money((deal as any).current_rent))}
              {row('Market rent', money((deal as any).market_rent))}
              {row('Section 8 / HUD rent', money((deal as any).section8_rent))}
              {row('Target rent', money((deal as any).target_rent))}
            </dl>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-xl font-bold">Expense assumptions</h2>
            <dl className="mt-4 text-sm">
              {row('Annual taxes', money((deal as any).taxes_annual))}
              {row('Annual insurance', money((deal as any).insurance_annual))}
              {row('Monthly HOA', money((deal as any).hoa_monthly))}
              {row('Monthly utilities', money((deal as any).utilities_monthly))}
              {row('Vacancy', percent((deal as any).vacancy_percent))}
              {row('Management', percent((deal as any).management_percent))}
            </dl>
          </div>
        </section>

        <FinancialSnapshot deal={deal as any} property={property as any} />
      </div>
    </AppShell>
  )
}
