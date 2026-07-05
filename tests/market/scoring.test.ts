import { describe, expect, it } from 'vitest'
import { normalizePropertyType, scoreMarketListing } from '@/lib/market/scoring'
import { classifyOpportunity } from '@/lib/market/opportunityRules'
import { determineDealReviewStatus, suggestedNextAction } from '@/lib/market/review'

const solidListing = {
  list_price: 120000,
  market_rent: 1500,
  current_rent: 1100,
  hud_rent: 1450,
  taxes_annual: 2400,
  insurance_annual: 1200,
  units: 2,
  zip_code: '44101',
  address: '12 Main St',
  city: 'Cleveland',
  bedrooms: 3,
  sqft: 1600,
  property_type: 'duplex',
  source_url: 'https://www.zillow.com/homedetails/1_zpid/',
  external_listing_id: 'zpid-1',
  primary_image_url: 'https://img.example/1.jpg',
  raw_payload: { source: 'test' },
}

describe('scoreMarketListing', () => {
  it('is deterministic: same input gives the same score', () => {
    const first = scoreMarketListing(solidListing)
    const second = scoreMarketListing({ ...solidListing })
    expect(second).toEqual(first)
  })

  it('scores a data-complete cashflowing listing well above an empty one', () => {
    const good = scoreMarketListing(solidListing)
    const empty = scoreMarketListing({})
    expect(good.dealScore).toBeGreaterThan(empty.dealScore)
    expect(good.dataConfidenceScore).toBeGreaterThan(empty.dataConfidenceScore)
  })

  it('never produces NaN or out-of-range scores on bad input', () => {
    const score = scoreMarketListing({ list_price: 'garbage', market_rent: Number.NaN, units: -5 })
    for (const value of [score.dealScore, score.riskScore, score.dataConfidenceScore, score.rentConfidenceScore, score.sourceConfidenceScore]) {
      expect(Number.isFinite(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(100)
    }
  })

  it('bad data never appears as high confidence', () => {
    const score = scoreMarketListing({ title: 'URL only listing' })
    expect(score.dataConfidence).toBe('low')
    expect(score.missingFields.length).toBeGreaterThanOrEqual(3)
  })

  it('reports missing fields for incomplete listings', () => {
    const score = scoreMarketListing({ list_price: 100000 })
    expect(score.missingFields).toContain('Current, market or HUD rent')
    expect(score.missingFields).toContain('ZIP code')
  })

  it('flags negative cashflow as a risk', () => {
    const score = scoreMarketListing({ ...solidListing, market_rent: 400, current_rent: 400, hud_rent: 0, taxes_annual: 9000 })
    expect(score.risks.join(' ')).toMatch(/cashflow|DSCR/i)
  })
})

describe('rank ordering', () => {
  it('better inputs never rank below worse inputs', () => {
    const weak = scoreMarketListing({ ...solidListing, market_rent: 900, hud_rent: 0, current_rent: 900 })
    const strong = scoreMarketListing(solidListing)
    expect(strong.dealScore).toBeGreaterThanOrEqual(weak.dealScore)
  })
})

describe('classifyOpportunity', () => {
  it('classifies strong opportunities (85+/65+)', () => {
    const rank = classifyOpportunity(90, 70)
    expect(rank.rank).toBe('strong_opportunity')
    expect(rank.isStrongOpportunity).toBe(true)
  })

  it('classifies opportunities (70+/50+)', () => {
    expect(classifyOpportunity(75, 55).rank).toBe('opportunity')
  })

  it('sends promising-but-unverified rent to needs_review', () => {
    const rank = classifyOpportunity(75, 30)
    expect(rank.rank).toBe('needs_review')
    expect(rank.shouldNeedsReview).toBe(true)
  })

  it('watchlists mid scores and missing data', () => {
    expect(classifyOpportunity(62, 62).rank).toBe('watchlist')
    expect(classifyOpportunity(30, 30, true).rank).toBe('watchlist')
  })

  it('leaves weak listings market-only', () => {
    expect(classifyOpportunity(30, 30).rank).toBe('market_only')
  })
})

describe('determineDealReviewStatus', () => {
  it('marks archived listings archived', () => {
    const result = determineDealReviewStatus({ deal_score: 90 }, { status: 'archived' })
    expect(result.dealStatus).toBe('archived')
  })

  it('marks listings without price as missing_data', () => {
    const result = determineDealReviewStatus({ dealScore: 50, missingFields: [] }, { title: 'No price' })
    expect(result.dealStatus).toBe('missing_data')
  })

  it('promotes qualified scores to ready/opportunity', () => {
    const result = determineDealReviewStatus(
      { dealScore: 80, rentConfidenceScore: 60, sourceConfidenceScore: 70, missingFields: [], estimatedMonthlyCashflow: 250, estimatedDscr: 1.3 },
      { list_price: 100000 }
    )
    expect(result.dealStatus).toBe('ready')
    expect(result.listingStatus).toBe('opportunity')
  })

  it('sends low rent confidence to low_confidence review', () => {
    const result = determineDealReviewStatus(
      { dealScore: 72, rentConfidenceScore: 30, sourceConfidenceScore: 70, missingFields: [] },
      { list_price: 100000 }
    )
    expect(result.dealStatus).toBe('low_confidence')
  })
})

describe('suggestedNextAction', () => {
  it('asks for manual data entry on URL-only fallback listings', () => {
    const action = suggestedNextAction({ raw_payload: { reviewRequired: true }, deal_status: 'missing_data' })
    expect(action.key).toBe('complete_provider_data')
  })

  it('asks to fill missing inputs when data is incomplete', () => {
    const action = suggestedNextAction({ deal_status: 'missing_data' }, { missing_fields: ['List or purchase price', 'ZIP code', 'Location'] })
    expect(action.key).toBe('fill_missing_inputs')
    expect(action.description).toContain('List or purchase price')
  })

  it('asks to verify rent on low confidence', () => {
    expect(suggestedNextAction({ deal_status: 'low_confidence' }).key).toBe('verify_rent')
  })

  it('suggests converting ready listings to deals', () => {
    expect(suggestedNextAction({ deal_status: 'ready' }).key).toBe('analyze_deal')
  })

  it('defaults to review-and-rescore', () => {
    expect(suggestedNextAction({ deal_status: 'needs_review' }).key).toBe('review_and_rescore')
  })
})

describe('normalizePropertyType', () => {
  it('maps common variants', () => {
    expect(normalizePropertyType('duplex')).toBe('Duplex')
    expect(normalizePropertyType('multi-family')).toBe('Multifamily')
    expect(normalizePropertyType('SINGLE_FAMILY')).toBe('Single Family')
    expect(normalizePropertyType('')).toBeNull()
  })
})
