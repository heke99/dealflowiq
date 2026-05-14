import Link from 'next/link'
import { createCalculationSnapshotAction } from '@/app/deals/actions'
import { scoreMarketListing } from '@/lib/market/scoring'
import {
  calculateDealUnderwriting,
  formatMoney,
  formatPercent,
  type DealUnderwritingSummary,
  type FormulaExplanation,
  type RentScenarioResult,
} from '@/lib/calculations/underwriting'

type CalculationSnapshotRow = {
  id: string
  snapshot_name: string | null
  formula_version: string | null
  created_at: string
  results?: any
}

type FinancialSnapshotProps = {
  deal: Record<string, any>
  property?: Record<string, any> | null
  showAnalyzerLink?: boolean
  showSnapshotTools?: boolean
  snapshots?: CalculationSnapshotRow[]
  message?: string | null
  error?: string | null
  showMethodology?: boolean
}

function metric(label: string, value: string, hint?: string, tone: 'default' | 'good' | 'bad' = 'default', explanation?: string) {
  const valueClass = tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-red-300' : 'text-white'
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm text-slate-400">{label}</div>
        {explanation ? <div className="rounded-full border border-white/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Formula</div> : null}
      </div>
      <div className={`mt-3 text-2xl font-bold ${valueClass}`}>{value}</div>
      {hint ? <div className="mt-3 text-xs leading-5 text-slate-500">{hint}</div> : null}
      {explanation ? <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs leading-5 text-slate-400">{explanation}</div> : null}
    </div>
  )
}

function row(label: string, value: string, tone: 'default' | 'good' | 'bad' = 'default', hint?: string) {
  const valueClass = tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-red-300' : 'text-slate-100'
  return (
    <div className="border-b border-white/10 py-3 last:border-b-0">
      <div className="flex justify-between gap-4">
        <dt className="text-slate-400">{label}</dt>
        <dd className={`text-right font-medium ${valueClass}`}>{value}</dd>
      </div>
      {hint ? <div className="mt-1 text-xs leading-5 text-slate-500">{hint}</div> : null}
    </div>
  )
}

function scenarioTone(value: number | null | undefined, goodAt = 0) {
  if (value === null || value === undefined) return 'default'
  return value >= goodAt ? 'good' : 'bad'
}

function findFormula(formulas: FormulaExplanation[], key: string) {
  return formulas.find((item) => item.key === key)
}

function FormulaCard({ formula }: { formula: FormulaExplanation }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
      <div className="font-semibold text-slate-100">{formula.label}</div>
      <div className="mt-2 rounded-xl border border-white/10 bg-black/20 p-3 font-mono text-xs text-slate-300">{formula.formula}</div>
      <p className="mt-3 text-xs leading-5 text-slate-400">{formula.source}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {formula.editableAssumptions.map((assumption) => (
          <span key={assumption} className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-slate-400">{assumption}</span>
        ))}
      </div>
    </div>
  )
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
        {row('NOI', formatMoney(scenario.noi), 'default', 'Effective gross income minus operating expenses, before debt service.')}
        {row('Cap rate', formatPercent(scenario.capRate), scenarioTone(scenario.capRate, 0.07), `NOI divided by selected value basis: ${formatMoney(scenario.capRateBasisValue)}.`)}
        {row('DSCR', scenario.dscr ? scenario.dscr.toFixed(2) : '—', scenarioTone(scenario.dscr, scenario.dscrThreshold), `Compared against your editable threshold: ${scenario.dscrThreshold.toFixed(2)}.`)}
        {row('Cash-on-cash', formatPercent(scenario.cashOnCashReturn), scenarioTone(scenario.cashOnCashReturn, 0.08))}
        {row('Annual rent upside', formatMoney(scenario.annualRentUpsideToCurrent), scenario.annualRentUpsideToCurrent >= 0 ? 'good' : 'bad')}
      </dl>
    </div>
  )
}

function SnapshotList({ snapshots }: { snapshots: CalculationSnapshotRow[] }) {
  if (!snapshots.length) {
    return <p className="mt-4 rounded-xl border border-white/10 bg-slate-900/70 p-4 text-sm text-slate-400">No saved snapshots yet. Save one before making major assumption changes.</p>
  }

  return (
    <div className="mt-4 space-y-3">
      {snapshots.map((snapshot) => {
        const primary = snapshot.results?.primaryScenario
        return (
          <div key={snapshot.id} className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="font-semibold text-slate-100">{snapshot.snapshot_name || 'Underwriting snapshot'}</div>
                <div className="mt-1 text-xs text-slate-500">{new Date(snapshot.created_at).toLocaleString()} · {snapshot.formula_version || 'formula version saved'}</div>
              </div>
              <div className="text-sm text-slate-300">
                {primary ? `${formatMoney(primary.monthlyCashflow)}/mo · DSCR ${primary.dscr ? Number(primary.dscr).toFixed(2) : '—'}` : 'Snapshot saved'}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function FinancialSnapshot({ deal, property, showAnalyzerLink = true, showSnapshotTools = false, snapshots = [], message, error, showMethodology = false }: FinancialSnapshotProps) {
  const summary: DealUnderwritingSummary = calculateDealUnderwriting(deal, property)
  const primary = summary.primaryScenario
  const decisionScore = scoreMarketListing({
    ...deal,
    list_price: deal.purchase_price || deal.asking_price,
    hud_rent: deal.section8_rent,
    units: property?.number_of_units,
    zip_code: property?.zip_code,
    address: property?.address,
    city: property?.city,
    state: property?.state,
  })
  const capRateFormula = findFormula(summary.formulaExplanations, 'cap_rate')
  const dscrFormula = findFormula(summary.formulaExplanations, 'dscr')
  const mortgageFormula = findFormula(summary.formulaExplanations, 'mortgage_payment')
  const breakEvenFormula = findFormula(summary.formulaExplanations, 'break_even_rent')

  return (
    <section className="space-y-6">
      {message ? <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">{message}</div> : null}
      {error ? <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">{error}</div> : null}

      <div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-6 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Financial Snapshot</div>
          <h2 className="mt-2 text-2xl font-bold">Core underwriting results</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            Smart summary of the deal using saved rent, debt and expense inputs. Update the key numbers above and the analysis refreshes immediately.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {showSnapshotTools ? (
            <form action={createCalculationSnapshotAction} className="flex flex-wrap gap-2">
              <input type="hidden" name="deal_id" value={deal.id} />
              <input type="hidden" name="redirect_to" value={`/deals/${deal.id}/analyzer`} />
              <input name="snapshot_name" placeholder="Snapshot name" className="w-44 rounded-xl border border-white/10 bg-slate-900/80 px-3 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-white/30" />
              <button className="rounded-xl bg-emerald-300 px-5 py-3 text-center text-sm font-semibold text-slate-950 transition hover:bg-emerald-200">Save Snapshot</button>
            </form>
          ) : null}
          {showAnalyzerLink ? (
            <Link href={`/deals/${deal.id}/analyzer`} className="rounded-xl bg-white px-5 py-3 text-center text-sm font-semibold text-slate-950 transition hover:bg-slate-200">
              Open Analyzer
            </Link>
          ) : null}
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Smart Analyze verdict</div>
            <h3 className="mt-2 text-2xl font-bold">{decisionScore.dealScore >= 75 ? 'Strong opportunity' : decisionScore.dealScore >= 55 ? 'Worth reviewing' : 'Needs more data or weak deal'}</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">DealFlowIQ ranks this deal using rent upside, cashflow, DSCR, cap rate, risk and data confidence. Add missing data or run Rent Intelligence to improve the score.</p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4"><div className="text-2xl font-bold text-emerald-100">{decisionScore.dealScore}</div><div className="text-xs uppercase tracking-wide text-emerald-200">Score</div></div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4"><div className="text-sm font-bold capitalize text-slate-100">{decisionScore.riskLevel}</div><div className="text-xs uppercase tracking-wide text-slate-500">Risk</div></div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4"><div className="text-sm font-bold capitalize text-slate-100">{decisionScore.dataConfidence}</div><div className="text-xs uppercase tracking-wide text-slate-500">Confidence</div></div>
          </div>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
            <div className="text-sm font-semibold text-slate-100">Why</div>
            <ul className="mt-3 space-y-2 text-sm text-slate-400">{decisionScore.reasons.slice(0, 4).map((item) => <li key={item}>• {item}</li>)}</ul>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
            <div className="text-sm font-semibold text-slate-100">Risks / missing data</div>
            <ul className="mt-3 space-y-2 text-sm text-slate-400">{[...decisionScore.risks, ...decisionScore.missingFields.map((field) => `${field} is missing.`)].slice(0, 4).map((item) => <li key={item}>• {item}</li>)}</ul>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metric('Monthly cashflow', `${formatMoney(primary.monthlyCashflow)}/mo`, primary.label, primary.monthlyCashflow >= 0 ? 'good' : 'bad', showMethodology ? 'Cashflow = NOI - annual debt service, divided monthly.' : undefined)}
        {metric('NOI', formatMoney(primary.noi), 'Annual net operating income', 'default', showMethodology ? 'NOI = effective gross income - operating expenses. Debt service is excluded.' : undefined)}
        {metric('Cap rate', formatPercent(primary.capRate), `${summary.assumptions.capRate.basis.replaceAll('_', ' ')} basis`, primary.capRate !== null && primary.capRate >= 0.07 ? 'good' : 'default', showMethodology ? capRateFormula?.formula : undefined)}
        {metric('DSCR', primary.dscr ? primary.dscr.toFixed(2) : '—', `Threshold: ${summary.assumptions.dscr.minimumThreshold.toFixed(2)}`, primary.dscr !== null && primary.dscr >= summary.assumptions.dscr.minimumThreshold ? 'good' : primary.dscr !== null ? 'bad' : 'default', showMethodology ? dscrFormula?.formula : undefined)}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metric('Monthly debt service', `${formatMoney(summary.monthlyDebtService)}/mo`, `${summary.interestRatePercent}% · ${summary.loanTermMonths} payments`, 'default', showMethodology ? mortgageFormula?.formula : undefined)}
        {metric('Loan amount', formatMoney(summary.loanAmount), `${summary.downPaymentPercent}% down payment`)}
        {metric('Cash needed', formatMoney(summary.cashNeeded), 'Down payment + rehab + closing costs')}
        {metric('Break-even rent', `${formatMoney(primary.breakEvenRent)}/mo`, 'Rent needed to cover expenses and debt', 'default', showMethodology ? breakEvenFormula?.formula : undefined)}
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
        <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Editable assumptions</div>
        <h3 className="mt-2 text-xl font-bold">Key assumptions</h3>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          These are the deal-level assumptions currently driving the numbers. Edit them directly from the deal or analyzer when your lender/program requires different inputs.
        </p>
        <div className="mt-5 grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><span className="font-semibold text-slate-100">Mortgage:</span> {summary.assumptions.mortgage.annualInterestRatePercent}% interest, {summary.assumptions.mortgage.monthlyPayments} payments.</div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><span className="font-semibold text-slate-100">DSCR threshold:</span> {summary.assumptions.dscr.minimumThreshold.toFixed(2)} minimum.</div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><span className="font-semibold text-slate-100">Cap rate basis:</span> {summary.assumptions.capRate.basis.replaceAll('_', ' ')} / {formatMoney(summary.assumptions.capRate.denominatorValue)}.</div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><span className="font-semibold text-slate-100">MAO %:</span> {summary.assumptions.wholesale.maoPercentage}%.</div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><span className="font-semibold text-slate-100">Vacancy / management:</span> {summary.assumptions.operating.vacancyPercent}% / {summary.assumptions.operating.managementPercent}%.</div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><span className="font-semibold text-slate-100">Refi LTV:</span> {summary.assumptions.brrrr.refinanceLtvPercent}%.</div>
        </div>
      </div>

      {showMethodology ? (
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Calculation methodology</div>
          <h3 className="mt-2 text-xl font-bold">Formula source and explanation</h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            These are conventional real estate underwriting formulas using the assumptions saved on this deal. Market Rent, Section 8 / HUD Rent and Target Rent are separate rent scenarios. HUD/FMR values are benchmarks, not guaranteed contract rents.
          </p>
          <div className="mt-5 grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-3">
            {summary.formulaExplanations.map((formula) => <FormulaCard key={formula.key} formula={formula} />)}
          </div>
        </div>
  
        ) : null}

      {showSnapshotTools ? (
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Calculation snapshots</div>
          <h3 className="mt-2 text-xl font-bold">Preserve historical analyses</h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Save a snapshot before changing assumptions. Snapshots store the formula version, assumptions and results so older analyses do not change when the deal inputs change later.
          </p>
          <SnapshotList snapshots={snapshots} />
        </div>
      ) : null}

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
              {row('Wholesale MAO', formatMoney(summary.wholesaleMAO), 'default', `Uses editable MAO %: ${summary.assumptions.wholesale.maoPercentage}%.`)}
              {row('Wholesale spread', formatMoney(summary.wholesaleSpread), summary.wholesaleSpread !== null && summary.wholesaleSpread >= 0 ? 'good' : 'bad')}
              {row('BRRRR refi loan', formatMoney(summary.brrrrRefiLoanAmount), 'default', `Uses editable refinance LTV: ${summary.assumptions.brrrr.refinanceLtvPercent}%.`)}
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
