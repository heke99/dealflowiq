import { describe, expect, it } from 'vitest'
import { buildCalculationSnapshotPayload, calculateDealUnderwriting, calculateMonthlyPayment } from '@/lib/calculations/underwriting'

const rentalDeal = {
  purchase_price: 200000,
  arv: 260000,
  rehab_estimate: 20000,
  closing_costs: 5000,
  current_rent: 1500,
  market_rent: 1900,
  section8_rent: 1850,
  taxes_annual: 3600,
  insurance_annual: 1200,
  vacancy_percent: 5,
  management_percent: 8,
  down_payment_percent: 20,
  interest_rate_percent: 7,
  loan_term_months: 360,
  dscr_min_threshold: 1.2,
  selling_costs_percent: 8,
  holding_costs_monthly: 1000,
  flip_holding_months: 6,
  mao_percentage: 70,
  desired_wholesale_fee: 10000,
  refinance_ltv_percent: 75,
}

describe('calculateMonthlyPayment', () => {
  it('matches the standard amortization formula', () => {
    // 160k, 7%, 360 payments → ~$1,064.48
    const payment = calculateMonthlyPayment({ principal: 160000, annualInterestRatePercent: 7, monthlyPayments: 360 })
    expect(payment).toBeCloseTo(1064.48, 1)
  })

  it('handles zero interest as straight-line', () => {
    expect(calculateMonthlyPayment({ principal: 120000, annualInterestRatePercent: 0, monthlyPayments: 120 })).toBe(1000)
  })

  it('returns 0 for zero principal', () => {
    expect(calculateMonthlyPayment({ principal: 0, annualInterestRatePercent: 7, monthlyPayments: 360 })).toBe(0)
  })
})

describe('calculateDealUnderwriting — core metrics', () => {
  const summary = calculateDealUnderwriting(rentalDeal, { number_of_units: 2 })
  const market = summary.scenarios.market

  it('computes NOI = EGI - fixed expenses - management', () => {
    const annualGross = 1900 * 12
    const vacancyLoss = annualGross * 0.05
    const management = annualGross * 0.08
    const fixed = 3600 + 1200
    const expectedNoi = annualGross - vacancyLoss - fixed - management
    expect(market.noi).toBeCloseTo(expectedNoi, 4)
  })

  it('computes DSCR = NOI / annual debt service', () => {
    expect(market.dscr).toBeCloseTo(market.noi / summary.annualDebtService, 6)
  })

  it('computes cap rate on the purchase price basis', () => {
    expect(market.capRate).toBeCloseTo(market.noi / 200000, 6)
  })

  it('computes cash-on-cash = annual cashflow / cash needed', () => {
    expect(summary.cashNeeded).toBe(200000 * 0.2 + 20000 + 5000)
    expect(market.cashOnCashReturn).toBeCloseTo(market.annualCashflow / summary.cashNeeded, 6)
  })

  it('break-even rent covers debt service and fixed expenses after vacancy/management', () => {
    const breakEven = market.breakEvenRent
    expect(breakEven).not.toBeNull()
    const annualAtBreakEven = (breakEven as number) * 12
    const recovered = annualAtBreakEven * (1 - 0.05 - 0.08)
    expect(recovered).toBeCloseTo(summary.annualDebtService + 3600 + 1200, 2)
  })

  it('prefers target > market > current for the primary scenario', () => {
    expect(summary.primaryScenario.key).toBe('market')
    const withTarget = calculateDealUnderwriting({ ...rentalDeal, target_rent: 2000 }, { number_of_units: 2 })
    expect(withTarget.primaryScenario.key).toBe('target')
    const currentOnly = calculateDealUnderwriting({ ...rentalDeal, market_rent: 0, section8_rent: 0 }, { number_of_units: 2 })
    expect(currentOnly.primaryScenario.key).toBe('current')
  })
})

describe('calculateDealUnderwriting — strategy previews', () => {
  it('flip profit multiplies holding costs by holding months', () => {
    const summary = calculateDealUnderwriting(rentalDeal)
    const sellingCosts = 260000 * 0.08
    const expected = 260000 - 200000 - 20000 - 5000 - sellingCosts - 1000 * 6
    expect(summary.flipProfit).toBeCloseTo(expected, 4)
  })

  it('flip holding months defaults to 6 when unset', () => {
    const withDefault = calculateDealUnderwriting({ ...rentalDeal, flip_holding_months: undefined })
    expect(withDefault.assumptions.flip.holdingMonths).toBe(6)
    expect(withDefault.flipProfit).toBe(calculateDealUnderwriting(rentalDeal).flipProfit)
  })

  it('wholesale MAO = ARV × MAO% - rehab - fee', () => {
    const summary = calculateDealUnderwriting(rentalDeal)
    expect(summary.wholesaleMAO).toBeCloseTo(260000 * 0.7 - 20000 - 10000, 4)
    expect(summary.wholesaleSpread).toBeCloseTo((summary.wholesaleMAO as number) - 200000, 4)
  })

  it('BRRRR cash left = total project cost - refi loan', () => {
    const summary = calculateDealUnderwriting(rentalDeal)
    expect(summary.brrrrRefiLoanAmount).toBeCloseTo(260000 * 0.75, 4)
    expect(summary.brrrrCashLeftInDeal).toBeCloseTo(200000 + 20000 + 5000 - 260000 * 0.75, 4)
  })
})

describe('calculateDealUnderwriting — guardrails', () => {
  it('never produces NaN or Infinity on empty input', () => {
    const summary = calculateDealUnderwriting({})
    const values = [
      summary.purchasePrice, summary.loanAmount, summary.monthlyDebtService, summary.cashNeeded,
      summary.primaryScenario.noi, summary.primaryScenario.monthlyCashflow,
    ]
    for (const value of values) {
      expect(Number.isFinite(value)).toBe(true)
    }
    expect(summary.primaryScenario.capRate).toBeNull()
    expect(summary.primaryScenario.dscr).toBeNull()
  })

  it('ignores unrealistic rents and warns instead of computing garbage', () => {
    const summary = calculateDealUnderwriting({ ...rentalDeal, market_rent: 250000, target_rent: 0 })
    expect(summary.scenarios.market.monthlyRent).toBe(0)
    expect(summary.warnings.join(' ')).toMatch(/Market Rent was ignored/)
  })

  it('nulls break-even rent when vacancy + management >= 100%', () => {
    const summary = calculateDealUnderwriting({ ...rentalDeal, vacancy_percent: 60, management_percent: 50 })
    expect(summary.scenarios.market.breakEvenRent).toBeNull()
  })

  it('warns on missing purchase price', () => {
    const summary = calculateDealUnderwriting({ market_rent: 1500 })
    expect(summary.warnings.join(' ')).toMatch(/Purchase price is missing/)
  })

  it('warns on negative cashflow and DSCR below threshold', () => {
    const summary = calculateDealUnderwriting({ ...rentalDeal, market_rent: 900, section8_rent: 0, current_rent: 0, taxes_annual: 9000 })
    expect(summary.warnings.join(' ')).toMatch(/negative monthly cashflow/i)
  })

  it('is deterministic for the same input', () => {
    expect(calculateDealUnderwriting(rentalDeal, { number_of_units: 2 })).toEqual(calculateDealUnderwriting({ ...rentalDeal }, { number_of_units: 2 }))
  })
})

describe('buildCalculationSnapshotPayload', () => {
  it('captures assumptions, results and warnings for immutable storage', () => {
    const summary = calculateDealUnderwriting(rentalDeal, { number_of_units: 2 })
    const payload = buildCalculationSnapshotPayload(summary)
    expect(payload.formula_version).toBe(summary.formulaVersion)
    expect(payload.assumptions.flip.holdingMonths).toBe(6)
    expect(payload.results.primaryScenario.key).toBe('market')
    expect(Array.isArray(payload.results.warnings)).toBe(true)
  })
})
