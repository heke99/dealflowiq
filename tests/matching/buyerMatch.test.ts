import { describe, expect, it } from 'vitest'
import {
  BUYER_MATCH_PERSIST_SCORE,
  BUYER_MATCH_REVIEW_SCORE,
  scoreBuyerListingMatch,
} from '@/lib/matching/buyerListingMatch'
import { capRateNumber, clampScore, moneyNumber, textList, withinRange } from '@/lib/matching/utils'

const perfectBuyer = {
  preferred_states: ['TX'],
  preferred_cities: ['Dallas'],
  preferred_zip_codes: ['75201'],
  property_types: ['duplex'],
  strategies: ['Buy & Hold'],
  min_budget: 100000,
  max_budget: 300000,
  min_units: 2,
  max_units: 4,
  min_bedrooms: 2,
  min_bathrooms: 1,
  min_sqft: 1200,
  min_cashflow: 300,
  min_dscr: 1.2,
  min_cap_rate: 7,
  min_arv_spread: 20000,
}

const moderateBuyer = {
  preferred_states: ['TX'],
  property_types: ['duplex'],
  strategies: ['Buy & Hold'],
  min_budget: 100000,
  max_budget: 300000,
}

const strongListing = {
  state: 'TX',
  city: 'Dallas',
  zip_code: '75201',
  property_type: 'Duplex',
  list_price: 200000,
  units: 2,
  bedrooms: 3,
  bathrooms: 2,
  sqft: 1600,
  arv: 280000,
  rehab_estimate: 20000,
}

const strongScore = {
  deal_score: 85,
  estimated_monthly_cashflow: 450,
  estimated_dscr: 1.35,
  estimated_cap_rate: 0.08,
  strategy_fit: 'buy_hold',
}

describe('scoreBuyerListingMatch', () => {
  it('scores a perfect-fit buyer at review level with reasons and no risks', () => {
    const result = scoreBuyerListingMatch(perfectBuyer, strongListing, strongScore)
    expect(result.matchScore).toBeGreaterThanOrEqual(BUYER_MATCH_REVIEW_SCORE)
    expect(result.risks).toEqual([])
    expect(result.reasons).toContain('Location fits buyer criteria.')
    expect(result.reasons).toContain('Property type fits buyer demand.')
    expect(result.reasons).toContain('Price fits buyer budget.')
  })

  it('is deterministic for the same input', () => {
    const first = scoreBuyerListingMatch(perfectBuyer, strongListing, strongScore)
    const second = scoreBuyerListingMatch({ ...perfectBuyer }, { ...strongListing }, { ...strongScore })
    expect(second).toEqual(first)
  })

  it('penalizes an out-of-budget buyer with a budget risk and a lower score', () => {
    const inBudget = scoreBuyerListingMatch(moderateBuyer, strongListing, strongScore)
    const outOfBudget = scoreBuyerListingMatch({ ...moderateBuyer, max_budget: 150000 }, strongListing, strongScore)
    expect(outOfBudget.matchScore).toBeLessThan(inBudget.matchScore)
    expect(outOfBudget.matchScore).toBeLessThan(BUYER_MATCH_REVIEW_SCORE)
    expect(outOfBudget.risks).toContain('Price is above buyer max budget.')
    expect(outOfBudget.reasons).not.toContain('Price fits buyer budget.')
  })

  it('penalizes a wrong-market buyer with a location risk and a lower score', () => {
    const rightMarket = scoreBuyerListingMatch(moderateBuyer, strongListing, strongScore)
    const wrongMarket = scoreBuyerListingMatch({ ...moderateBuyer, preferred_states: ['OH'] }, strongListing, strongScore)
    expect(wrongMarket.matchScore).toBeLessThan(rightMarket.matchScore)
    expect(wrongMarket.risks).toContain('Location is outside buyer criteria.')
  })

  it('flags weak underwriting scores as a risk', () => {
    const result = scoreBuyerListingMatch(moderateBuyer, strongListing, { ...strongScore, deal_score: 50 })
    expect(result.risks).toContain('DealFlowIQ score is below strong-opportunity range.')
  })

  it('treats min_cap_rate given as percent (7) and decimal (0.07) identically', () => {
    const percentForm = scoreBuyerListingMatch({ ...moderateBuyer, min_cap_rate: 7 }, strongListing, strongScore)
    const decimalForm = scoreBuyerListingMatch({ ...moderateBuyer, min_cap_rate: 0.07 }, strongListing, strongScore)
    expect(percentForm).toEqual(decimalForm)
  })

  it('stays below the persist cutoff for a broad buyer on a priced listing with no underwriting data', () => {
    const result = scoreBuyerListingMatch({}, { list_price: 100000 }, null)
    expect(result.matchScore).toBe(50)
    expect(result.matchScore).toBeLessThan(BUYER_MATCH_PERSIST_SCORE)
  })

  it('crosses the persist cutoff once positive cashflow data appears', () => {
    const result = scoreBuyerListingMatch({}, { list_price: 100000 }, { estimated_monthly_cashflow: 200 })
    expect(result.matchScore).toBe(56)
    expect(result.matchScore).toBeGreaterThanOrEqual(BUYER_MATCH_PERSIST_SCORE)
    expect(result.matchScore).toBeLessThan(BUYER_MATCH_REVIEW_SCORE)
  })

  it('sits just around the review cutoff depending on DSCR support', () => {
    const buyer = { preferred_zip_codes: ['75201'], property_types: ['duplex'], max_budget: 300000 }
    const listing = { zip_code: '75201', property_type: 'Duplex', list_price: 200000 }
    const belowReview = scoreBuyerListingMatch(buyer, listing, { estimated_monthly_cashflow: 100 })
    const atReview = scoreBuyerListingMatch(buyer, listing, { estimated_monthly_cashflow: 100, estimated_dscr: 1.25 })
    expect(belowReview.matchScore).toBe(75)
    expect(belowReview.matchScore).toBeLessThan(BUYER_MATCH_REVIEW_SCORE)
    expect(atReview.matchScore).toBe(81)
    expect(atReview.matchScore).toBeGreaterThanOrEqual(BUYER_MATCH_REVIEW_SCORE)
  })

  it('clamps hard mismatches to zero and falls back to a generic reason', () => {
    const buyer = { preferred_states: ['OH'], property_types: ['land'], strategies: ['flip'] }
    const listing = { state: 'TX', property_type: 'Duplex' }
    const result = scoreBuyerListingMatch(buyer, listing, null)
    expect(result.matchScore).toBe(0)
    expect(result.reasons).toEqual(['Buyer has broad criteria and this listing has enough data to review.'])
    expect(result.risks.length).toBeGreaterThanOrEqual(3)
  })

  it('never produces out-of-range or non-finite scores on garbage input', () => {
    const result = scoreBuyerListingMatch(
      { min_budget: 'garbage', preferred_states: 'not-an-array' },
      { list_price: Number.NaN, units: -3 },
      { deal_score: 'oops' },
    )
    expect(Number.isFinite(result.matchScore)).toBe(true)
    expect(result.matchScore).toBeGreaterThanOrEqual(0)
    expect(result.matchScore).toBeLessThanOrEqual(100)
  })
})

describe('matching utils', () => {
  it('textList normalizes arrays and rejects non-arrays', () => {
    expect(textList([' TX ', '', 42, 'Dallas'])).toEqual(['tx', '42', 'dallas'])
    expect(textList('TX, OH')).toEqual([])
    expect(textList(null)).toEqual([])
  })

  it('moneyNumber coerces money-like values and falls back to 0', () => {
    expect(moneyNumber('250000')).toBe(250000)
    expect(moneyNumber(125.5)).toBe(125.5)
    expect(moneyNumber(undefined)).toBe(0)
    expect(moneyNumber('garbage')).toBe(0)
  })

  it('capRateNumber normalizes percent values above 1 into decimals', () => {
    expect(capRateNumber(7)).toBeCloseTo(0.07)
    expect(capRateNumber(0.065)).toBeCloseTo(0.065)
    expect(capRateNumber('not a rate')).toBe(0)
    expect(capRateNumber(null)).toBe(0)
  })

  it('withinRange honors optional inclusive bounds', () => {
    expect(withinRange(100, 50, 150)).toBe(true)
    expect(withinRange(100, 100, 100)).toBe(true)
    expect(withinRange(100, 150, null)).toBe(false)
    expect(withinRange(100, null, 50)).toBe(false)
    expect(withinRange(100)).toBe(true)
    expect(withinRange(100, Number.NaN, Number.NaN)).toBe(true)
  })

  it('clampScore rounds and clamps into 0-100', () => {
    expect(clampScore(-10)).toBe(0)
    expect(clampScore(150)).toBe(100)
    expect(clampScore(72.4)).toBe(72)
    expect(clampScore(72.5)).toBe(73)
  })
})
