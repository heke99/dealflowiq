export type DealLike = Record<string, unknown>
export type PropertyLike = Record<string, unknown> | null | undefined

export type RentScenarioKey = 'current' | 'market' | 'section8' | 'target'

export type RentScenarioResult = {
  key: RentScenarioKey
  label: string
  monthlyRent: number
  annualGrossRent: number
  vacancyLoss: number
  effectiveGrossIncome: number
  operatingExpenses: number
  noi: number
  monthlyNoi: number
  annualDebtService: number
  monthlyDebtService: number
  annualCashflow: number
  monthlyCashflow: number
  capRate: number | null
  dscr: number | null
  cashOnCashReturn: number | null
  pricePerUnit: number | null
  rentPerUnit: number | null
  noiPerUnit: number | null
  cashflowPerUnit: number | null
  breakEvenRent: number | null
  rentGapToCurrent: number
  annualRentUpsideToCurrent: number
}

export type DealUnderwritingSummary = {
  purchasePrice: number
  arv: number
  rehabEstimate: number
  units: number
  downPaymentAmount: number
  downPaymentPercent: number
  loanAmount: number
  interestRatePercent: number
  loanTermYears: number
  monthlyDebtService: number
  annualDebtService: number
  cashNeeded: number
  scenarios: Record<RentScenarioKey, RentScenarioResult>
  primaryScenario: RentScenarioResult
  marketRentGap: number
  section8RentGap: number
  targetRentGap: number
  flipProfit: number | null
  flipProfitMargin: number | null
  wholesaleMAO: number | null
  wholesaleSpread: number | null
  brrrrRefiLoanAmount: number | null
  brrrrCashLeftInDeal: number | null
  warnings: string[]
}

const RENT_SCENARIOS: Array<{ key: RentScenarioKey; label: string; field: string }> = [
  { key: 'current', label: 'Current Rent', field: 'current_rent' },
  { key: 'market', label: 'Market Rent', field: 'market_rent' },
  { key: 'section8', label: 'Section 8 / HUD Rent', field: 'section8_rent' },
  { key: 'target', label: 'Target Rent', field: 'target_rent' },
]

function n(value: unknown, fallback = 0) {
  const parsed = Number(value ?? fallback)
  return Number.isFinite(parsed) ? parsed : fallback
}

function positive(value: unknown, fallback = 0) {
  return Math.max(0, n(value, fallback))
}

function percent(value: unknown, fallback = 0) {
  return Math.max(0, n(value, fallback)) / 100
}

export function calculateMonthlyPayment(params: {
  principal: number
  annualInterestRatePercent: number
  termYears: number
}) {
  const principal = Math.max(0, params.principal)
  const termMonths = Math.max(1, Math.round(params.termYears * 12))
  const monthlyRate = Math.max(0, params.annualInterestRatePercent) / 100 / 12

  if (!principal) return 0
  if (!monthlyRate) return principal / termMonths

  return principal * (monthlyRate * Math.pow(1 + monthlyRate, termMonths)) / (Math.pow(1 + monthlyRate, termMonths) - 1)
}

function calculateScenario(params: {
  key: RentScenarioKey
  label: string
  monthlyRent: number
  currentRent: number
  purchasePrice: number
  units: number
  annualDebtService: number
  monthlyDebtService: number
  cashNeeded: number
  annualFixedExpenses: number
  vacancyPercent: number
  managementPercent: number
}) : RentScenarioResult {
  const annualGrossRent = params.monthlyRent * 12
  const vacancyLoss = annualGrossRent * params.vacancyPercent
  const managementFee = annualGrossRent * params.managementPercent
  const effectiveGrossIncome = annualGrossRent - vacancyLoss
  const operatingExpenses = params.annualFixedExpenses + managementFee + vacancyLoss
  const noi = effectiveGrossIncome - params.annualFixedExpenses - managementFee
  const annualCashflow = noi - params.annualDebtService
  const monthlyCashflow = annualCashflow / 12
  const capRate = params.purchasePrice > 0 ? noi / params.purchasePrice : null
  const dscr = params.annualDebtService > 0 ? noi / params.annualDebtService : null
  const cashOnCashReturn = params.cashNeeded > 0 ? annualCashflow / params.cashNeeded : null
  const breakEvenAnnualRent = params.annualDebtService + params.annualFixedExpenses
  const breakEvenRent = 1 - params.vacancyPercent - params.managementPercent > 0
    ? breakEvenAnnualRent / (1 - params.vacancyPercent - params.managementPercent) / 12
    : null

  return {
    key: params.key,
    label: params.label,
    monthlyRent: params.monthlyRent,
    annualGrossRent,
    vacancyLoss,
    effectiveGrossIncome,
    operatingExpenses,
    noi,
    monthlyNoi: noi / 12,
    annualDebtService: params.annualDebtService,
    monthlyDebtService: params.monthlyDebtService,
    annualCashflow,
    monthlyCashflow,
    capRate,
    dscr,
    cashOnCashReturn,
    pricePerUnit: params.units > 0 && params.purchasePrice > 0 ? params.purchasePrice / params.units : null,
    rentPerUnit: params.units > 0 ? params.monthlyRent / params.units : null,
    noiPerUnit: params.units > 0 ? noi / params.units : null,
    cashflowPerUnit: params.units > 0 ? monthlyCashflow / params.units : null,
    breakEvenRent,
    rentGapToCurrent: params.monthlyRent - params.currentRent,
    annualRentUpsideToCurrent: (params.monthlyRent - params.currentRent) * 12,
  }
}

export function calculateDealUnderwriting(deal: DealLike, property?: PropertyLike): DealUnderwritingSummary {
  const purchasePrice = positive(deal.purchase_price || deal.contract_price || deal.asking_price)
  const arv = positive(deal.arv)
  const rehabEstimate = positive(deal.rehab_estimate)
  const units = Math.max(1, Math.round(positive(property?.number_of_units, 1) || 1))
  const currentRent = positive(deal.current_rent)

  const downPaymentPercent = positive(deal.down_payment_percent, 20)
  const explicitDownPayment = positive(deal.down_payment_amount)
  const downPaymentAmount = explicitDownPayment > 0 ? explicitDownPayment : purchasePrice * (downPaymentPercent / 100)
  const loanAmount = positive(deal.loan_amount) || Math.max(0, purchasePrice - downPaymentAmount)
  const interestRatePercent = positive(deal.interest_rate_percent, 7)
  const loanTermYears = positive(deal.loan_term_years, 30) || 30
  const monthlyDebtService = calculateMonthlyPayment({ principal: loanAmount, annualInterestRatePercent: interestRatePercent, termYears: loanTermYears })
  const annualDebtService = monthlyDebtService * 12
  const closingCosts = positive(deal.closing_costs)
  const cashNeeded = downPaymentAmount + rehabEstimate + closingCosts

  const annualFixedExpenses =
    positive(deal.taxes_annual) +
    positive(deal.insurance_annual) +
    positive(deal.hoa_monthly) * 12 +
    positive(deal.utilities_monthly) * 12 +
    positive(deal.capex_monthly) * 12

  const vacancyPercent = percent(deal.vacancy_percent, 5)
  const managementPercent = percent(deal.management_percent, 8)

  const scenarios = RENT_SCENARIOS.reduce<Record<RentScenarioKey, RentScenarioResult>>((acc, item) => {
    const monthlyRent = positive(deal[item.field]) || (item.key === 'current' ? currentRent : 0)
    acc[item.key] = calculateScenario({
      key: item.key,
      label: item.label,
      monthlyRent,
      currentRent,
      purchasePrice,
      units,
      annualDebtService,
      monthlyDebtService,
      cashNeeded,
      annualFixedExpenses,
      vacancyPercent,
      managementPercent,
    })
    return acc
  }, {} as Record<RentScenarioKey, RentScenarioResult>)

  const primaryScenario = scenarios.target.monthlyRent > 0
    ? scenarios.target
    : scenarios.market.monthlyRent > 0
      ? scenarios.market
      : scenarios.current

  const sellingCostsPercent = percent(deal.selling_costs_percent, 8)
  const holdingCostsMonthly = positive(deal.holding_costs_monthly)
  const sellingCosts = arv * sellingCostsPercent
  const flipProfit = arv > 0 && purchasePrice > 0 ? arv - purchasePrice - rehabEstimate - closingCosts - sellingCosts - holdingCostsMonthly : null
  const flipProfitMargin = flipProfit !== null && arv > 0 ? flipProfit / arv : null

  const desiredWholesaleFee = positive(deal.desired_wholesale_fee, 10000)
  const wholesaleMAO = arv > 0 ? arv * 0.7 - rehabEstimate - desiredWholesaleFee : null
  const wholesaleSpread = wholesaleMAO !== null && purchasePrice > 0 ? wholesaleMAO - purchasePrice : null

  const refinanceLtvPercent = positive(deal.refinance_ltv_percent, 75)
  const brrrrRefiLoanAmount = arv > 0 ? arv * (refinanceLtvPercent / 100) : null
  const totalProjectCost = purchasePrice + rehabEstimate + closingCosts
  const brrrrCashLeftInDeal = brrrrRefiLoanAmount !== null ? totalProjectCost - brrrrRefiLoanAmount : null

  const warnings: string[] = []
  if (!purchasePrice) warnings.push('Purchase price is missing. Cap rate, financing and offer metrics will be incomplete.')
  if (!currentRent && !primaryScenario.monthlyRent) warnings.push('Rent assumptions are missing. Add current, market or target rent to calculate cashflow.')
  if (primaryScenario.dscr !== null && primaryScenario.dscr < 1.2) warnings.push('DSCR is below 1.20. Many lenders may consider this weak or borderline.')
  if (primaryScenario.monthlyCashflow < 0) warnings.push('Primary scenario has negative monthly cashflow.')
  if (flipProfitMargin !== null && flipProfitMargin < 0.1) warnings.push('Flip margin is below 10%. This deal may not survive rehab or timeline surprises.')
  if (wholesaleSpread !== null && wholesaleSpread < desiredWholesaleFee) warnings.push('Wholesale spread is thin based on the current MAO assumptions.')

  return {
    purchasePrice,
    arv,
    rehabEstimate,
    units,
    downPaymentAmount,
    downPaymentPercent,
    loanAmount,
    interestRatePercent,
    loanTermYears,
    monthlyDebtService,
    annualDebtService,
    cashNeeded,
    scenarios,
    primaryScenario,
    marketRentGap: scenarios.market.rentGapToCurrent,
    section8RentGap: scenarios.section8.rentGapToCurrent,
    targetRentGap: scenarios.target.rentGapToCurrent,
    flipProfit,
    flipProfitMargin,
    wholesaleMAO,
    wholesaleSpread,
    brrrrRefiLoanAmount,
    brrrrCashLeftInDeal,
    warnings,
  }
}

export function formatMoney(value: number | null | undefined, options?: { compact?: boolean }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: options?.compact ? 'compact' : 'standard',
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(2)}%`
}
