import Link from 'next/link'
import {
  calculateDealUnderwriting,
  formatMoney,
  formatPercent,
  type DealUnderwritingSummary,
  type RentScenarioResult,
} from '@/lib/calculations/underwriting'

type FinancialSnapshotProps = {
  deal: Record<string, any>
  property?: Record<string, any> | null
  showAnalyzerLink?: boolean
}

function metric(label: string, value: string, hint?: string, tone: 'default' | 'good' | 'bad' = 'default') {
  const valueClass = tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-red-300' : 'text-white'
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
      <div className="text-sm text-slate-400">{label}</div>
      <div className={`mt-3 text-2xl font-bold ${valueClass}`}>{value}</div>
      {hint ? <div className="mt-3 text-xs leading-5 text-slate-500">{hint}</div> : null}
    </div>
  )
}

function row(label: string, value: string, tone: 'default' | 'good' | 'bad' = 'default') {
  const valueClass = tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-red-300' : 'text-slate-100'
  return (
    <div className="flex justify-between gap-4 border-b border-white/10 py-3 last:border-b-0">
      <dt className="text-slate-400">{label}</dt>
      <dd className={`text-right font-medium ${valueClass}`}>{value}</dd>
    </div>
  )
}

function scenarioTone(value: number | null | undefined, goodAt = 0) {
  if (value === null || value === undefined) return 'default'
  return value >= goodAt ? 'good' : 'bad'
}

function ScenarioCard({ scenario }: { scenario: RentScenarioResult }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold">{scenario.label}</h3>
          <p className="mt-1 text-xs text-slate-500">Monthly rent: {formatMoney(scenario.monthlyRent)}</p>
        </div>
        <div className={scenario.monthlyCashflow >= 0 ? 'text-right text-sm font-semibold text-emerald-300' : 'text-right text-sm font-semibold text-red-300'}>
          {formatMoney(scenario.monthlyCashflow)}/mo
        </div>
      </div>
      <dl className="mt-4 text-sm">
        {row('NOI', formatMoney(scenario.noi))}
        {row('Cap rate', formatPercent(scenario.capRate), scenarioTone(scenario.capRate, 0.07))}
        {row('DSCR', scenario.dscr ? scenario.dscr.toFixed(2) : '—', scenarioTone(scenario.dscr, 1.2))}
        {row('Cash-on-cash', formatPercent(scenario.cashOnCashReturn), scenarioTone(scenario.cashOnCashReturn, 0.08))}
        {row('Annual rent upside', formatMoney(scenario.annualRentUpsideToCurrent), scenario.annualRentUpsideToCurrent >= 0 ? 'good' : 'bad')}
      </dl>
    </div>
  )
}

export function FinancialSnapshot({ deal, property, showAnalyzerLink = true }: FinancialSnapshotProps) {
  const summary: DealUnderwritingSummary = calculateDealUnderwriting(deal, property)
  const primary = summary.primaryScenario

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-6 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Financial Snapshot</div>
          <h2 className="mt-2 text-2xl font-bold">Core underwriting results</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            These numbers are calculated from the saved deal assumptions. Edit the deal to adjust rent, expenses, financing, ARV and rehab assumptions.
          </p>
        </div>
        {showAnalyzerLink ? (
          <Link href={`/deals/${deal.id}/analyzer`} className="rounded-xl bg-white px-5 py-3 text-center text-sm font-semibold text-slate-950 transition hover:bg-slate-200">
            Open Analyzer
          </Link>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metric('Monthly cashflow', `${formatMoney(primary.monthlyCashflow)}/mo`, primary.label, primary.monthlyCashflow >= 0 ? 'good' : 'bad')}
        {metric('NOI', formatMoney(primary.noi), 'Annual net operating income')}
        {metric('Cap rate', formatPercent(primary.capRate), 'NOI / purchase price', primary.capRate !== null && primary.capRate >= 0.07 ? 'good' : 'default')}
        {metric('DSCR', primary.dscr ? primary.dscr.toFixed(2) : '—', 'NOI / annual debt service', primary.dscr !== null && primary.dscr >= 1.2 ? 'good' : primary.dscr !== null ? 'bad' : 'default')}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metric('Monthly debt service', `${formatMoney(summary.monthlyDebtService)}/mo`, `${summary.interestRatePercent}% · ${summary.loanTermYears} years`)}
        {metric('Loan amount', formatMoney(summary.loanAmount), `${summary.downPaymentPercent}% down payment`)}
        {metric('Cash needed', formatMoney(summary.cashNeeded), 'Down payment + rehab + closing costs')}
        {metric('Break-even rent', `${formatMoney(primary.breakEvenRent)}/mo`, 'Rent needed to cover expenses and debt')}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_0.85fr]">
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <h3 className="text-xl font-bold">Rent scenario comparison</h3>
          <p className="mt-2 text-sm text-slate-400">Compare current, market, Section 8/HUD and target rent side by side.</p>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {Object.values(summary.scenarios).map((scenario) => <ScenarioCard key={scenario.key} scenario={scenario} />)}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h3 className="text-xl font-bold">Strategy preview</h3>
            <dl className="mt-4 text-sm">
              {row('Flip profit', formatMoney(summary.flipProfit), summary.flipProfit !== null && summary.flipProfit >= 0 ? 'good' : 'bad')}
              {row('Flip margin', formatPercent(summary.flipProfitMargin), summary.flipProfitMargin !== null && summary.flipProfitMargin >= 0.1 ? 'good' : 'bad')}
              {row('Wholesale MAO', formatMoney(summary.wholesaleMAO))}
              {row('Wholesale spread', formatMoney(summary.wholesaleSpread), summary.wholesaleSpread !== null && summary.wholesaleSpread >= 0 ? 'good' : 'bad')}
              {row('BRRRR refi loan', formatMoney(summary.brrrrRefiLoanAmount))}
              {row('Cash left in deal', formatMoney(summary.brrrrCashLeftInDeal), summary.brrrrCashLeftInDeal !== null && summary.brrrrCashLeftInDeal <= 0 ? 'good' : 'default')}
            </dl>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h3 className="text-xl font-bold">Risk warnings</h3>
            {summary.warnings.length ? (
              <ul className="mt-4 space-y-3 text-sm text-amber-100">
                {summary.warnings.map((warning) => (
                  <li key={warning} className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">{warning}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-100">No major warnings from the current assumptions.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
