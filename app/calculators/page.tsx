import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { canUseFeature } from '@/lib/billing/features'
import { calculateDealUnderwriting, formatMoney, formatPercent } from '@/lib/calculations/underwriting'

type Search = Record<string, string | string[] | undefined>

function one(value: string | string[] | undefined, fallback = '') {
  if (Array.isArray(value)) return value[0] || fallback
  return value || fallback
}

function num(params: Search | undefined, key: string, fallback = 0) {
  const parsed = Number(String(one(params?.[key], String(fallback))).replace(/[$,\s]/g, ''))
  return Number.isFinite(parsed) ? parsed : fallback
}

function input(label: string, name: string, value: number | string, hint?: string) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-300">{label}</span>
      <input name={name} type="number" step="0.01" defaultValue={value} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none focus:border-white/30" />
      {hint ? <span className="mt-1 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  )
}

function card(label: string, value: string, hint?: string, tone: 'default' | 'good' | 'bad' = 'default') {
  const toneClass = tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-red-300' : 'text-white'
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
      <div className="text-sm text-slate-400">{label}</div>
      <div className={`mt-3 text-2xl font-bold ${toneClass}`}>{value}</div>
      {hint ? <p className="mt-2 text-xs leading-5 text-slate-500">{hint}</p> : null}
    </div>
  )
}

export default async function CalculatorsPage({ searchParams }: { searchParams?: Promise<Search> }) {
  const params = await searchParams
  const workspace = await getCurrentWorkspace()
  const purchasePrice = num(params, 'purchase_price', 350000)
  const marketRent = num(params, 'market_rent', 2800)
  const section8Rent = num(params, 'section8_rent', 0)
  const currentRent = num(params, 'current_rent', 0)
  const arv = num(params, 'arv', 450000)
  const rehab = num(params, 'rehab_estimate', 40000)
  const taxes = num(params, 'taxes_annual', 4200)
  const insurance = num(params, 'insurance_annual', 1800)
  const down = num(params, 'down_payment_percent', 20)
  const interest = num(params, 'interest_rate_percent', 7)
  const loanMonths = num(params, 'loan_term_months', 360)
  const sellingCosts = num(params, 'selling_costs_percent', 8)
  const holdingCosts = num(params, 'holding_costs_monthly', 0)
  const mao = num(params, 'mao_percentage', 70)
  const wholesaleFee = num(params, 'desired_wholesale_fee', 10000)
  const refiLtv = num(params, 'refinance_ltv_percent', 75)

  const deal = {
    purchase_price: purchasePrice,
    asking_price: purchasePrice,
    arv,
    rehab_estimate: rehab,
    current_rent: currentRent,
    market_rent: marketRent,
    section8_rent: section8Rent,
    taxes_annual: taxes,
    insurance_annual: insurance,
    down_payment_percent: down,
    interest_rate_percent: interest,
    loan_term_months: loanMonths,
    vacancy_percent: num(params, 'vacancy_percent', 5),
    management_percent: num(params, 'management_percent', 8),
    capex_monthly: num(params, 'capex_monthly', 0),
    closing_costs: num(params, 'closing_costs', 0),
    selling_costs_percent: sellingCosts,
    holding_costs_monthly: holdingCosts,
    mao_percentage: mao,
    desired_wholesale_fee: wholesaleFee,
    refinance_ltv_percent: refiLtv,
    dscr_min_threshold: num(params, 'dscr_min_threshold', 1.2),
  }
  const summary = calculateDealUnderwriting(deal, { number_of_units: num(params, 'units', 1) })
  const primary = summary.primaryScenario

  const premium = [
    ['BRRRR Calculator', 'brrrr', 'Refi proceeds and cash left in deal.'],
    ['Fix & Flip Calculator', 'flip', 'ARV minus purchase, rehab, closing, selling and holding costs.'],
    ['Wholesale Calculator', 'wholesale', 'Editable MAO %, fee and spread.'],
    ['5-Year Projection', 'five_year_projection', 'Growth assumptions and long-term view coming next.'],
  ] as const

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
          <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Live underwriting tools</div>
          <h1 className="mt-2 text-3xl font-bold">Calculators</h1>
          <p className="mt-3 max-w-3xl text-slate-300">
            Test rental, BRRRR, flip and wholesale assumptions before saving a deal. These use the same DealFlowIQ underwriting engine as Analyzer and Opportunities.
          </p>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-xl font-bold">Inputs</h2>
          <form className="mt-5 grid gap-4 md:grid-cols-3 xl:grid-cols-6" action="/calculators">
            {input('Purchase price', 'purchase_price', purchasePrice)}
            {input('ARV', 'arv', arv)}
            {input('Rehab', 'rehab_estimate', rehab)}
            {input('Market rent', 'market_rent', marketRent)}
            {input('HUD rent', 'section8_rent', section8Rent)}
            {input('Current rent', 'current_rent', currentRent)}
            {input('Taxes / year', 'taxes_annual', taxes)}
            {input('Insurance / year', 'insurance_annual', insurance)}
            {input('Units', 'units', num(params, 'units', 1))}
            {input('Down payment %', 'down_payment_percent', down)}
            {input('Interest %', 'interest_rate_percent', interest)}
            {input('Loan months', 'loan_term_months', loanMonths)}
            {input('Vacancy %', 'vacancy_percent', num(params, 'vacancy_percent', 5))}
            {input('Management %', 'management_percent', num(params, 'management_percent', 8))}
            {input('CapEx / month', 'capex_monthly', num(params, 'capex_monthly', 0))}
            {input('Selling costs %', 'selling_costs_percent', sellingCosts)}
            {input('Holding costs / mo', 'holding_costs_monthly', holdingCosts)}
            {input('MAO %', 'mao_percentage', mao)}
            {input('Wholesale fee', 'desired_wholesale_fee', wholesaleFee)}
            {input('Refi LTV %', 'refinance_ltv_percent', refiLtv)}
            {input('DSCR target', 'dscr_min_threshold', num(params, 'dscr_min_threshold', 1.2))}
            <button className="rounded-xl bg-white px-5 py-3 font-semibold text-slate-950 hover:bg-slate-200 md:col-span-3 xl:col-span-6">Recalculate</button>
          </form>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {card('Monthly cashflow', `${formatMoney(primary.monthlyCashflow)}/mo`, primary.label, primary.monthlyCashflow >= 0 ? 'good' : 'bad')}
          {card('NOI', formatMoney(primary.noi), 'Annual net operating income')}
          {card('Cap rate', formatPercent(primary.capRate), 'NOI divided by selected basis', primary.capRate !== null && primary.capRate >= 0.07 ? 'good' : 'default')}
          {card('DSCR', primary.dscr ? primary.dscr.toFixed(2) : '—', `Target ${summary.assumptions.dscr.minimumThreshold.toFixed(2)}`, primary.dscr !== null && primary.dscr >= summary.assumptions.dscr.minimumThreshold ? 'good' : 'bad')}
          {card('Debt service', `${formatMoney(summary.monthlyDebtService)}/mo`, `${summary.interestRatePercent}% · ${summary.loanTermMonths} payments`)}
          {card('Break-even rent', `${formatMoney(primary.breakEvenRent)}/mo`, 'Rent needed to cover debt and fixed expenses')}
          {card('Cash needed', formatMoney(summary.cashNeeded), 'Down payment + rehab + closing costs')}
          {card('Cash-on-cash', formatPercent(primary.cashOnCashReturn), 'Annual cashflow / cash invested', primary.cashOnCashReturn !== null && primary.cashOnCashReturn >= 0.08 ? 'good' : 'default')}
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {card('Flip profit', formatMoney(summary.flipProfit), `Selling costs ${sellingCosts}%`, summary.flipProfit !== null && summary.flipProfit >= 0 ? 'good' : 'bad')}
          {card('Wholesale spread', formatMoney(summary.wholesaleSpread), `MAO ${mao}% · fee ${formatMoney(wholesaleFee)}`, summary.wholesaleSpread !== null && summary.wholesaleSpread >= 0 ? 'good' : 'bad')}
          {card('BRRRR cash left', formatMoney(summary.brrrrCashLeftInDeal), `Refi LTV ${refiLtv}%`, summary.brrrrCashLeftInDeal !== null && summary.brrrrCashLeftInDeal <= 0 ? 'good' : 'default')}
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-xl font-bold">Premium calculators</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {premium.map(([title, feature, text]) => {
              const enabled = canUseFeature(workspace.access.features, feature)
              return (
                <div key={feature} className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-bold">{title}</h3>
                    <span className={enabled ? 'rounded-full bg-emerald-400/10 px-2 py-1 text-xs font-semibold text-emerald-200' : 'rounded-full bg-amber-400/10 px-2 py-1 text-xs font-semibold text-amber-200'}>
                      {enabled ? 'Enabled' : 'Upgrade'}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-400">{text}</p>
                </div>
              )
            })}
          </div>
        </section>

        <Link href="/deals" className="inline-flex rounded-xl border border-white/10 px-5 py-3 font-semibold text-slate-100 transition hover:bg-white/10">
          Open saved deals
        </Link>
      </div>
    </AppShell>
  )
}
