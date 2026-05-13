export type DealLike = Record<string, unknown>
export type PropertyLike = Record<string, unknown> | null | undefined

export type RentScenarioKey = 'current' | 'market' | 'section8' | 'target'
export type CapRateBasis = 'purchase_price' | 'arv' | 'custom_value'

export type UnderwritingAssumptions = {
  formulaVersion: string
  mortgage: {
    principal: number
    annualInterestRatePercent: number
    monthlyPayments: number
    source: string
  }
  operating: {
    vacancyPercent: number
    managementPercent: number
    annualFixedExpenses: number
    source: string
  }
  capRate: {
    basis: CapRateBasis
    denominatorValue: number
    source: string
  }
  dscr: {
    minimumThreshold: number
    source: string
  }
  wholesale: {
    maoPercentage: number
    desiredWholesaleFee: number
    source: string
  }
  flip: {
    sellingCostsPercent: number
    holdingCostsMonthly: number
    source: string
  }
  brrrr: {
    refinanceLtvPercent: number
    source: string
  }
  projection: {
    rentGrowthPercent: number
    expenseGrowthPercent: number
    exitCapRatePercent: number
    source: string
  }
}

export type FormulaExplanation = {
  key: string
  label: string
  formula: string
  source: string
  editableAssumptions: string[]
}

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
  capRateBasisValue: number
  dscr: number | null
  dscrThreshold: number
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
  formulaVersion: string
  purchasePrice: number
  arv: number
  rehabEstimate: number
  units: number
  downPaymentAmount: number
  downPaymentPercent: number
  loanAmount: number
  interestRatePercent: number
  loanTermYears: number
  loanTermMonths: number
  monthlyDebtService: number
  annualDebtService: number
  cashNeeded: number
  assumptions: UnderwritingAssumptions
  formulaExplanations: FormulaExplanation[]
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

const FORMULA_VERSION = 'dealflowiq-underwriting-v1.1'

const RENT_SCENARIOS: Array<{ key: RentScenarioKey; label: string; field: string }> = [
  { key: 'current', label: 'Current Rent', field: 'current_rent' },
  { key: 'market', label: 'Market Rent', field: 'market_rent' },
  { key: 'section8', label: 'Section 8 / HUD Rent', field: 'section8_rent' },
  { key: 'target', label: 'Target Rent', field: 'target_rent' },
]

export const FORMULA_EXPLANATIONS: FormulaExplanation[] = [
  {
    key: 'mortgage_payment',
    label: 'Mortgage payment',
    formula: 'Monthly payment = P × [r(1+r)^n] / [(1+r)^n - 1]',
    source: 'Standard fixed-rate amortized loan payment formula. Edit interest rate, principal and number of monthly payments to adjust it.',
    editableAssumptions: ['Loan amount', 'Interest rate %', 'Number of monthly payments'],
  },
  {
    key: 'noi',
    label: 'NOI',
    formula: 'NOI = Effective gross income - operating expenses',
    source: 'Standard income-property underwriting formula. Debt service is not included in NOI.',
    editableAssumptions: ['Rent scenario', 'Vacancy %', 'Taxes', 'Insurance', 'HOA', 'Utilities', 'Management %', 'CapEx reserve'],
  },
  {
    key: 'cap_rate',
    label: 'Cap rate',
    formula: 'Cap rate = NOI / selected value basis',
    source: 'Standard capitalization-rate formula. You can use purchase price, ARV or a custom value as the denominator.',
    editableAssumptions: ['Cap rate basis', 'Custom cap rate value', 'NOI inputs'],
  },
  {
    key: 'dscr',
    label: 'DSCR',
    formula: 'DSCR = NOI / annual debt service',
    source: 'Common lender underwriting ratio. Threshold should be editable because requirements vary by lender and loan program.',
    editableAssumptions: ['DSCR minimum threshold', 'Interest rate %', 'Number of monthly payments', 'Loan amount', 'NOI inputs'],
  },
  {
    key: 'cashflow',
    label: 'Cashflow',
    formula: 'Cashflow = NOI - annual debt service',
    source: 'Standard pre-tax cashflow formula for financed rental underwriting.',
    editableAssumptions: ['NOI inputs', 'Debt service inputs'],
  },
  {
    key: 'cash_on_cash',
    label: 'Cash-on-cash return',
    formula: 'Cash-on-cash = annual pre-tax cashflow / cash invested',
    source: 'Common investor return metric. Cash invested is down payment + rehab + closing costs in this MVP engine.',
    editableAssumptions: ['Down payment', 'Rehab estimate', 'Closing costs', 'Cashflow inputs'],
  },
  {
    key: 'break_even_rent',
    label: 'Break-even rent',
    formula: 'Break-even rent = (annual debt service + fixed operating expenses) / (1 - vacancy % - management %) / 12',
    source: 'Underwriting estimate for rent needed to cover operating costs and debt service.',
    editableAssumptions: ['Vacancy %', 'Management %', 'Annual fixed expenses', 'Debt service'],
  },
  {
    key: 'flip_profit',
    label: 'Flip profit preview',
    formula: 'Flip profit = ARV - purchase price - rehab - closing costs - selling costs - holding costs',
    source: 'Common fix-and-flip preview. This is a quick model, not a full construction budget.',
    editableAssumptions: ['ARV', 'Purchase price', 'Rehab estimate', 'Closing costs', 'Selling costs %', 'Monthly holding costs'],
  },
  {
    key: 'wholesale_mao',
    label: 'Wholesale MAO preview',
    formula: 'MAO = ARV × MAO % - rehab - desired wholesale fee',
    source: 'Common wholesaler rule-of-thumb. The MAO percentage is editable and should not always be 70%.',
    editableAssumptions: ['MAO %', 'ARV', 'Rehab estimate', 'Desired wholesale fee'],
  },
  {
    key: 'brrrr',
    label: 'BRRRR refi preview',
    formula: 'Refi loan = ARV × refinance LTV; cash left = total project cost - refi loan',
    source: 'Standard BRRRR preview comparing project cost to refinance proceeds.',
    editableAssumptions: ['ARV', 'Refinance LTV %', 'Purchase price', 'Rehab estimate', 'Closing costs'],
  },
  {
    key: 'projection_assumptions',
    label: 'Projection assumptions',
    formula: 'Future rent/expenses/value use editable rent growth %, expense growth % and exit cap rate %',
    source: 'DealFlowIQ projection assumptions. They are saved on each deal so every user can override organization defaults for that specific analysis.',
    editableAssumptions: ['Rent growth %', 'Expense growth %', 'Exit cap rate %'],
  },
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

function capRateBasis(value: unknown): CapRateBasis {
  return value === 'arv' || value === 'custom_value' ? value : 'purchase_price'
}

export function calculateMonthlyPayment(params: {
  principal: number
  annualInterestRatePercent: number
  monthlyPayments: number
}) {
  const principal = Math.max(0, params.principal)
  const termMonths = Math.max(1, Math.round(params.monthlyPayments))
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
  capRateBasisValue: number
  units: number
  annualDebtService: number
  monthlyDebtService: number
  cashNeeded: number
  annualFixedExpenses: number
  vacancyPercent: number
  managementPercent: number
  dscrThreshold: number
}) : RentScenarioResult {
  const annualGrossRent = params.monthlyRent * 12
  const vacancyLoss = annualGrossRent * params.vacancyPercent
  const managementFee = annualGrossRent * params.managementPercent
  const effectiveGrossIncome = annualGrossRent - vacancyLoss
  const operatingExpenses = params.annualFixedExpenses + managementFee + vacancyLoss
  const noi = effectiveGrossIncome - params.annualFixedExpenses - managementFee
  const annualCashflow = noi - params.annualDebtService
  const monthlyCashflow = annualCashflow / 12
  const capRate = params.capRateBasisValue > 0 ? noi / params.capRateBasisValue : null
  const dscr = params.annualDebtService > 0 ? noi / params.annualDebtService : null
  const cashOnCashReturn = params.cashNeeded > 0 ? annualCashflow / params.cashNeeded : null
  const breakEvenAnnualRent = params.annualDebtService + params.annualFixedExpenses
  const denominator = 1 - params.vacancyPercent - params.managementPercent
  const breakEvenRent = denominator > 0 ? breakEvenAnnualRent / denominator / 12 : null

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
    capRateBasisValue: params.capRateBasisValue,
    dscr,
    dscrThreshold: params.dscrThreshold,
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
  const loanTermMonths = Math.max(1, Math.round(positive(deal.loan_term_months, loanTermYears * 12) || loanTermYears * 12))
  const monthlyDebtService = calculateMonthlyPayment({ principal: loanAmount, annualInterestRatePercent: interestRatePercent, monthlyPayments: loanTermMonths })
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
  const dscrMinThreshold = positive(deal.dscr_min_threshold, 1.2) || 1.2
  const basis = capRateBasis(deal.cap_rate_basis)
  const customCapValue = positive(deal.cap_rate_custom_value)
  const capRateBasisValue = basis === 'arv' ? arv : basis === 'custom_value' ? customCapValue : purchasePrice

  const assumptions: UnderwritingAssumptions = {
    formulaVersion: FORMULA_VERSION,
    mortgage: {
      principal: loanAmount,
      annualInterestRatePercent: interestRatePercent,
      monthlyPayments: loanTermMonths,
      source: 'Standard fixed-rate amortized loan payment formula.',
    },
    operating: {
      vacancyPercent: vacancyPercent * 100,
      managementPercent: managementPercent * 100,
      annualFixedExpenses,
      source: 'Operating-expense assumptions saved on the deal. NOI excludes debt service.',
    },
    capRate: {
      basis,
      denominatorValue: capRateBasisValue,
      source: 'Cap rate uses the selected denominator: purchase price, ARV or custom value.',
    },
    dscr: {
      minimumThreshold: dscrMinThreshold,
      source: 'DSCR threshold is editable because lender requirements vary.',
    },
    wholesale: {
      maoPercentage: positive(deal.mao_percentage, 70),
      desiredWholesaleFee: positive(deal.desired_wholesale_fee, 10000),
      source: 'MAO percentage is editable; 70% is only a common rule-of-thumb.',
    },
    flip: {
      sellingCostsPercent: positive(deal.selling_costs_percent, 8),
      holdingCostsMonthly: positive(deal.holding_costs_monthly),
      source: 'Quick flip preview assumptions. Full project budget comes later.',
    },
    brrrr: {
      refinanceLtvPercent: positive(deal.refinance_ltv_percent, 75),
      source: 'BRRRR preview based on ARV × refinance LTV compared with project cost.',
    },
    projection: {
      rentGrowthPercent: n(deal.rent_growth_percent, 3),
      expenseGrowthPercent: n(deal.expense_growth_percent, 3),
      exitCapRatePercent: positive(deal.exit_cap_rate_percent, 7),
      source: 'Per-deal projection assumptions. Organization defaults only prefill new deals; each user can override these on the deal.',
    },
  }

  const scenarios = RENT_SCENARIOS.reduce<Record<RentScenarioKey, RentScenarioResult>>((acc, item) => {
    const monthlyRent = positive(deal[item.field]) || (item.key === 'current' ? currentRent : 0)
    acc[item.key] = calculateScenario({
      key: item.key,
      label: item.label,
      monthlyRent,
      currentRent,
      purchasePrice,
      capRateBasisValue,
      units,
      annualDebtService,
      monthlyDebtService,
      cashNeeded,
      annualFixedExpenses,
      vacancyPercent,
      managementPercent,
      dscrThreshold: dscrMinThreshold,
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
  const maoPercentage = positive(deal.mao_percentage, 70) / 100
  const wholesaleMAO = arv > 0 ? arv * maoPercentage - rehabEstimate - desiredWholesaleFee : null
  const wholesaleSpread = wholesaleMAO !== null && purchasePrice > 0 ? wholesaleMAO - purchasePrice : null

  const refinanceLtvPercent = positive(deal.refinance_ltv_percent, 75)
  const brrrrRefiLoanAmount = arv > 0 ? arv * (refinanceLtvPercent / 100) : null
  const totalProjectCost = purchasePrice + rehabEstimate + closingCosts
  const brrrrCashLeftInDeal = brrrrRefiLoanAmount !== null ? totalProjectCost - brrrrRefiLoanAmount : null

  const warnings: string[] = []
  if (!purchasePrice) warnings.push('Purchase price is missing. Cap rate, financing and offer metrics will be incomplete.')
  if (basis === 'custom_value' && !customCapValue) warnings.push('Cap rate basis is custom value, but no custom cap rate value is entered.')
  if (!currentRent && !primaryScenario.monthlyRent) warnings.push('Rent assumptions are missing. Add current, market or target rent to calculate cashflow.')
  if (primaryScenario.dscr !== null && primaryScenario.dscr < dscrMinThreshold) warnings.push(`DSCR is below your ${dscrMinThreshold.toFixed(2)} threshold. Adjust the threshold per lender/program if needed.`)
  if (primaryScenario.monthlyCashflow < 0) warnings.push('Primary scenario has negative monthly cashflow.')
  if (flipProfitMargin !== null && flipProfitMargin < 0.1) warnings.push('Flip margin is below 10%. This deal may not survive rehab or timeline surprises.')
  if (wholesaleSpread !== null && wholesaleSpread < desiredWholesaleFee) warnings.push('Wholesale spread is thin based on the current MAO assumptions.')

  return {
    formulaVersion: FORMULA_VERSION,
    purchasePrice,
    arv,
    rehabEstimate,
    units,
    downPaymentAmount,
    downPaymentPercent,
    loanAmount,
    interestRatePercent,
    loanTermYears,
    loanTermMonths,
    monthlyDebtService,
    annualDebtService,
    cashNeeded,
    assumptions,
    formulaExplanations: FORMULA_EXPLANATIONS,
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

export function buildCalculationSnapshotPayload(summary: DealUnderwritingSummary) {
  return {
    formula_version: summary.formulaVersion,
    assumptions: summary.assumptions,
    results: {
      purchasePrice: summary.purchasePrice,
      arv: summary.arv,
      rehabEstimate: summary.rehabEstimate,
      units: summary.units,
      downPaymentAmount: summary.downPaymentAmount,
      loanAmount: summary.loanAmount,
      monthlyDebtService: summary.monthlyDebtService,
      annualDebtService: summary.annualDebtService,
      cashNeeded: summary.cashNeeded,
      primaryScenario: summary.primaryScenario,
      scenarios: summary.scenarios,
      marketRentGap: summary.marketRentGap,
      section8RentGap: summary.section8RentGap,
      targetRentGap: summary.targetRentGap,
      flipProfit: summary.flipProfit,
      flipProfitMargin: summary.flipProfitMargin,
      wholesaleMAO: summary.wholesaleMAO,
      wholesaleSpread: summary.wholesaleSpread,
      brrrrRefiLoanAmount: summary.brrrrRefiLoanAmount,
      brrrrCashLeftInDeal: summary.brrrrCashLeftInDeal,
      warnings: summary.warnings,
    },
    formula_sources: summary.formulaExplanations,
  }
}

export function formatMoney(value: number | null | undefined, options?: { compact?: boolean }) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
    notation: options?.compact ? 'compact' : 'standard',
  }).format(value)
}

export function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${(value * 100).toFixed(2)}%`
}
