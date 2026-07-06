import { describe, expect, it } from 'vitest'
import {
  MAX_REASONABLE_MONTHLY_RENT,
  MIN_REASONABLE_MONTHLY_RENT,
  isReasonableMonthlyRent,
  normalizeMonthlyRent,
  summarizeMarketRentComps,
} from '@/lib/underwriting/rentIntelligence'

describe('rent guardrails', () => {
  it('accepts rents inside the reasonable band', () => {
    expect(isReasonableMonthlyRent(MIN_REASONABLE_MONTHLY_RENT)).toBe(true)
    expect(isReasonableMonthlyRent(1500)).toBe(true)
    expect(isReasonableMonthlyRent(MAX_REASONABLE_MONTHLY_RENT)).toBe(true)
  })

  it('rejects sale prices and junk as monthly rent', () => {
    expect(isReasonableMonthlyRent(120000)).toBe(false)
    expect(isReasonableMonthlyRent(100)).toBe(false)
    expect(isReasonableMonthlyRent('not a number')).toBe(false)
    expect(isReasonableMonthlyRent(null)).toBe(false)
  })

  it('normalizes currency-formatted strings', () => {
    expect(normalizeMonthlyRent('$1,450')).toBe(1450)
    expect(normalizeMonthlyRent('$450,000')).toBeNull()
  })
})

describe('summarizeMarketRentComps', () => {
  it('computes median, average and range from valid comps', () => {
    const summary = summarizeMarketRentComps([
      { monthly_rent: 1400 },
      { monthly_rent: 1500 },
      { monthly_rent: 1600 },
    ])
    expect(summary.validCount).toBe(3)
    expect(summary.medianRent).toBe(1500)
    expect(summary.averageRent).toBe(1500)
    expect(summary.lowRent).toBe(1400)
    expect(summary.highRent).toBe(1600)
    expect(summary.recommendedRent).toBe(1500)
  })

  it('filters unreasonable rents and warns', () => {
    const summary = summarizeMarketRentComps([
      { monthly_rent: 1500 },
      { monthly_rent: 350000 }, // a sale price entered by mistake
    ])
    expect(summary.validCount).toBe(1)
    expect(summary.warnings.join(' ')).toMatch(/outside the reasonable monthly rent range/)
  })

  it('removes statistical outliers once enough comps exist', () => {
    const summary = summarizeMarketRentComps([
      { monthly_rent: 1400 },
      { monthly_rent: 1450 },
      { monthly_rent: 1500 },
      { monthly_rent: 1550 },
      { monthly_rent: 1600 },
      { monthly_rent: 9000 }, // luxury outlier
    ])
    expect(summary.validCount).toBe(5)
    expect(summary.recommendedRent).toBe(1500)
    expect(summary.warnings.join(' ')).toMatch(/outlier/)
  })

  it('confidence grows with comp count and sqft coverage', () => {
    const few = summarizeMarketRentComps([{ monthly_rent: 1500 }])
    const many = summarizeMarketRentComps([
      { monthly_rent: 1400, square_feet: 900 },
      { monthly_rent: 1450, square_feet: 950 },
      { monthly_rent: 1500, square_feet: 1000 },
      { monthly_rent: 1550, square_feet: 1050 },
      { monthly_rent: 1600, square_feet: 1100 },
    ])
    expect(many.confidenceScore).toBeGreaterThan(few.confidenceScore)
    expect(many.averageRentPerSqft).not.toBeNull()
  })

  it('handles the empty case without crashing', () => {
    const summary = summarizeMarketRentComps([])
    expect(summary.validCount).toBe(0)
    expect(summary.recommendedRent).toBeNull()
    expect(summary.confidenceScore).toBe(0)
  })
})
