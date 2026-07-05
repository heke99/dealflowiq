import { describe, expect, it } from 'vitest'
import {
  buildNormalizedListingKey,
  buildUrlOnlyMarketListing,
  detectSourceType,
  isSearchResultsUrl,
  parseMarketCsvText,
  type NormalizedMarketListing,
} from '@/lib/market/sourceConnectors'

describe('detectSourceType', () => {
  it.each([
    ['https://www.zillow.com/homedetails/123-Main-St/456_zpid/', 'zillow'],
    ['https://www.redfin.com/OH/Cleveland/home/12345', 'redfin'],
    ['https://www.realtor.com/realestateandhomes-detail/123-Main', 'realtor'],
    ['https://www.crexi.com/properties/12345/some-property', 'crexi'],
    ['https://www.loopnet.com/Listing/123-Main-St/12345/', 'loopnet'],
    ['https://www.apartments.com/cleveland-oh/', 'apartments'],
    ['https://app.investorlift.com/deals/999', 'investorlift'],
    ['https://example.com/listing/1', 'manual_url'],
  ])('%s → %s', (url, expected) => {
    expect(detectSourceType(url)).toBe(expected)
  })

  it('handles null/undefined defensively', () => {
    expect(detectSourceType(null)).toBe('manual_url')
    expect(detectSourceType(undefined)).toBe('manual_url')
  })
})

describe('isSearchResultsUrl', () => {
  it('detects Zillow searchQueryState URLs', () => {
    expect(isSearchResultsUrl('https://www.zillow.com/homes/?searchQueryState=%7B%7D')).toBe(true)
  })

  it('detects common search paths', () => {
    expect(isSearchResultsUrl('https://www.zillow.com/homes/cleveland-oh/')).toBe(true)
    expect(isSearchResultsUrl('https://www.realtor.com/realestateandhomes-search/Cleveland_OH')).toBe(true)
    expect(isSearchResultsUrl('https://app.investorlift.com/deals')).toBe(true)
  })

  it('rejects non-http values', () => {
    expect(isSearchResultsUrl('not-a-url')).toBe(false)
    expect(isSearchResultsUrl(null)).toBe(false)
  })
})

describe('buildNormalizedListingKey (dedupe key)', () => {
  it('prefers the source URL, lowercased', () => {
    const listing = { source_url: 'https://Zillow.com/HomeDetails/1_zpid/', external_listing_id: 'x1' } as unknown as NormalizedMarketListing
    expect(buildNormalizedListingKey(listing)).toBe('url:https://zillow.com/homedetails/1_zpid/')
  })

  it('falls back to the external listing id', () => {
    const listing = { source_url: null, external_listing_id: 'zpid-99' } as unknown as NormalizedMarketListing
    expect(buildNormalizedListingKey(listing)).toBe('external:zpid-99')
  })

  it('falls back to normalized address parts', () => {
    const listing = { source_url: null, external_listing_id: null, address: '12 Main St', city: 'Cleveland', state: 'OH', zip_code: '44101' } as unknown as NormalizedMarketListing
    expect(buildNormalizedListingKey(listing)).toContain('12 main st')
    expect(buildNormalizedListingKey(listing)).toContain('44101')
  })

  it('is stable for identical input', () => {
    const listing = { source_url: 'https://a.example/1' } as unknown as NormalizedMarketListing
    expect(buildNormalizedListingKey(listing)).toBe(buildNormalizedListingKey({ ...listing }))
  })
})

describe('buildUrlOnlyMarketListing (fetch-failure fallback)', () => {
  it('produces a review-required listing preserving the URL and source type', () => {
    const listing = buildUrlOnlyMarketListing('https://www.zillow.com/homedetails/12-Main-St/998877_zpid/', 'zillow', 'blocked')
    expect(listing.source_type).toBe('zillow')
    expect(listing.source_url).toBe('https://www.zillow.com/homedetails/12-Main-St/998877_zpid/')
    expect(listing.raw_payload?.reviewRequired).toBe(true)
    expect(listing.title).toBeTruthy()
  })

  it('extracts an external id when the URL contains one', () => {
    const listing = buildUrlOnlyMarketListing('https://www.zillow.com/homedetails/12-Main-St/998877_zpid/', 'zillow')
    expect(listing.external_listing_id).toContain('998877')
  })

  it('detects source type when not provided', () => {
    const listing = buildUrlOnlyMarketListing('https://www.redfin.com/OH/Cleveland/home/321')
    expect(listing.source_type).toBe('redfin')
  })
})

describe('parseMarketCsvText', () => {
  const csv = [
    'title,address,city,state,zip,list_price,market_rent,source_url',
    '"Duplex A","12 Main St",Cleveland,OH,44101,120000,1400,https://www.zillow.com/homedetails/1_zpid/',
    '"Fourplex B","44 Oak Ave",Akron,OH,44301,240000,2600,',
  ].join('\n')

  it('parses rows with headers into normalized listings', () => {
    const rows = parseMarketCsvText(csv)
    expect(rows).toHaveLength(2)
    expect(rows[0].title).toBe('Duplex A')
    expect(rows[0].city).toBe('Cleveland')
    expect(rows[0].zip_code).toBe('44101')
    expect(Number(rows[0].list_price)).toBe(120000)
  })

  it('detects source type per row from the source URL', () => {
    const rows = parseMarketCsvText(csv)
    expect(rows[0].source_type).toBe('zillow')
    expect(rows[1].source_type).toBe('csv')
  })

  it('returns empty for header-only or blank input', () => {
    expect(parseMarketCsvText('title,address')).toEqual([])
    expect(parseMarketCsvText('')).toEqual([])
  })
})
