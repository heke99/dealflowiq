import { describe, expect, it } from 'vitest'
import { analyzeMarketUrl } from '@/lib/market/urlAnalyzer'

describe('analyzeMarketUrl', () => {
  it('rejects invalid URLs', () => {
    expect(() => analyzeMarketUrl('not a url')).toThrow()
    expect(() => analyzeMarketUrl('ftp://example.com/x')).toThrow()
  })

  it('classifies a Zillow listing URL', () => {
    const analysis = analyzeMarketUrl('https://www.zillow.com/homedetails/12-Main-St-Cleveland-OH-44101/998877_zpid/')
    expect(analysis.sourceType).toBe('zillow')
    expect(analysis.isSearchUrl).toBe(false)
    expect(analysis.isListingUrl).toBe(true)
  })

  it('classifies a Zillow search URL with searchQueryState and extracts price filters', () => {
    const state = encodeURIComponent(JSON.stringify({
      usersSearchTerm: 'Cleveland OH',
      filterState: { price: { min: 50000, max: 250000 } },
    }))
    const analysis = analyzeMarketUrl(`https://www.zillow.com/homes/for_sale/?searchQueryState=${state}`)
    expect(analysis.sourceType).toBe('zillow')
    expect(analysis.isSearchUrl).toBe(true)
    expect(analysis.minPrice).toBe(50000)
    expect(analysis.maxPrice).toBe(250000)
    expect(analysis.targetState).toBe('OH')
  })

  it('classifies generic search paths as search imports', () => {
    const analysis = analyzeMarketUrl('https://www.realtor.com/realestateandhomes-search/Cleveland_OH')
    expect(analysis.isSearchUrl).toBe(true)
  })

  it('normalizes the URL', () => {
    const analysis = analyzeMarketUrl('  https://www.redfin.com/OH/Cleveland/home/123  ')
    expect(analysis.normalizedUrl).toBe('https://www.redfin.com/OH/Cleveland/home/123')
  })
})
