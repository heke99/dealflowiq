import { describe, expect, it } from 'vitest'
import { evaluateBuyBoxCriteria } from '@/lib/market/importRunner'
import { scoreMarketListing } from '@/lib/market/scoring'

const strongListing = {
  list_price: 150000,
  market_rent: 1800,
  current_rent: 1400,
  hud_rent: 1750,
  taxes_annual: 2400,
  insurance_annual: 1100,
  units: 2,
  sqft: 1800,
  zip_code: '44105',
  address: '22 Elm St',
  city: 'Cleveland',
  state: 'OH',
  bedrooms: 4,
  property_type: 'Duplex',
  source_url: 'https://www.zillow.com/homedetails/22_zpid/',
  external_listing_id: 'zpid-22',
  primary_image_url: 'https://img.example/22.jpg',
  raw_payload: { source: 'test' },
}

const score = scoreMarketListing(strongListing)

describe('evaluateBuyBoxCriteria', () => {
  it('without a buy box, falls back to the score-only gate', () => {
    const result = evaluateBuyBoxCriteria(null, strongListing, score, 70)
    expect(result.matchScore).toBe(score.dealScore)
    expect(['opportunity', 'matched']).toContain(result.matchedStatus)
  })

  it('matches a listing that satisfies location, type and price criteria', () => {
    const buyBox = {
      id: 'bb-1',
      city: 'Cleveland',
      state: 'OH',
      property_types: ['duplex'],
      min_price: 100000,
      max_price: 200000,
      min_units: 2,
    }
    const result = evaluateBuyBoxCriteria(buyBox, strongListing, score, 40)
    expect(result.matchScore).toBeGreaterThanOrEqual(55)
    expect(result.reasons.join(' ')).toMatch(/Location matches/)
    expect(result.reasons.join(' ')).toMatch(/Property type matches/)
    expect(result.reasons.join(' ')).toMatch(/Price is inside/)
  })

  it('penalizes wrong location with an explicit mismatch risk', () => {
    const buyBox = { id: 'bb-2', city: 'Austin', state: 'TX' }
    const result = evaluateBuyBoxCriteria(buyBox, strongListing, score, 40)
    expect(result.risks.join(' ')).toMatch(/outside Buy Box criteria/)
  })

  it('penalizes over-budget listings', () => {
    const buyBox = { id: 'bb-3', max_price: 100000 }
    const result = evaluateBuyBoxCriteria(buyBox, strongListing, score, 40)
    expect(result.risks.join(' ')).toMatch(/above Buy Box maximum/)
  })

  it('flags deal score below the buy box threshold', () => {
    const buyBox = { id: 'bb-4' }
    const result = evaluateBuyBoxCriteria(buyBox, strongListing, score, 99)
    expect(result.risks.join(' ')).toMatch(/below Buy Box threshold/)
    expect(result.matchedStatus).not.toBe('opportunity')
  })

  it('includes a criteria snapshot for explainability', () => {
    const buyBox = { id: 'bb-5', city: 'Cleveland', min_price: 100000, max_price: 200000 }
    const result = evaluateBuyBoxCriteria(buyBox, strongListing, score, 70)
    const snapshot = result.snapshot as Record<string, unknown>
    expect(snapshot.buyBoxId).toBe('bb-5')
    expect(snapshot.threshold).toBe(70)
    expect(snapshot.criteria).toMatchObject({ city: 'Cleveland', min_price: 100000, max_price: 200000 })
  })

  it('clamps the match score to 0..100', () => {
    const hostileBuyBox = {
      id: 'bb-6',
      city: 'Nowhere',
      state: 'ZZ',
      property_types: ['castle'],
      max_price: 1,
      min_units: 99,
      min_cashflow: 99999,
      min_dscr: 9,
      min_cap_rate: 99,
    }
    const result = evaluateBuyBoxCriteria(hostileBuyBox, strongListing, score, 99)
    expect(result.matchScore).toBeGreaterThanOrEqual(0)
    expect(result.matchScore).toBeLessThanOrEqual(100)
    expect(result.matchedStatus).toBe('needs_review')
  })
})
