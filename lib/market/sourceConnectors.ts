import { normalizePropertyType } from '@/lib/market/scoring'
import { getMarketSourceAdapter } from '@/lib/market/sourceAdapters'
import { isReasonableMonthlyRent } from '@/lib/underwriting/rentIntelligence'

export type MarketSourceType = 'zillow' | 'crexi' | 'loopnet' | 'redfin' | 'realtor' | 'apartments' | 'investorlift' | 'csv' | 'partner_api' | 'mls_feed' | 'manual' | 'manual_url' | 'other'



const SEARCH_DISCOVERY_LIMIT = 40
const SEARCH_DISCOVERY_TIMEOUT_MS = 5000
const LISTING_FETCH_TIMEOUT_MS = 5000
const MAX_SOURCE_HTML_CHARS = 2500000

function timeoutMessage(sourceType: string, mode: 'search' | 'listing', timeoutMs: number) {
  return `${sourceType} ${mode} import timed out after ${Math.round(timeoutMs / 1000)} seconds. Narrow the search, try a direct listing URL, or retry later.`
}

async function fetchTextWithTimeout(url: string, params: { sourceType: string; mode: 'search' | 'listing'; timeoutMs: number; headers: Record<string, string> }) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs)
  try {
    const response = await fetch(url, {
      headers: params.headers,
      cache: 'no-store',
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`${params.sourceType} ${params.mode} import returned HTTP ${response.status}. Use authorized access/API or paste the listing manually if the source blocks server fetch.`)
    }

    const html = await response.text()
    return html.length > MAX_SOURCE_HTML_CHARS ? html.slice(0, MAX_SOURCE_HTML_CHARS) : html
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(timeoutMessage(params.sourceType, params.mode, params.timeoutMs))
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export type NormalizedMarketListing = {
  source_type: MarketSourceType
  external_listing_id: string | null
  source_url: string | null
  title: string
  address: string | null
  city: string | null
  state: string | null
  zip_code: string | null
  county: string | null
  property_type: string | null
  units: number | null
  bedrooms: number | null
  bathrooms: number | null
  sqft: number | null
  lot_size: string | null
  year_built: number | null
  list_price: number | null
  asking_price: number | null
  arv: number | null
  rehab_estimate: number | null
  current_rent: number | null
  market_rent: number | null
  hud_rent: number | null
  estimated_rent: number | null
  taxes_annual: number | null
  insurance_annual: number | null
  hoa_monthly: number | null
  utilities_monthly: number | null
  description: string | null
  broker_name: string | null
  broker_phone: string | null
  broker_email: string | null
  primary_image_url: string | null
  image_urls: string[]
  raw_payload: Record<string, unknown>
}

function cleanText(value: unknown) {
  const text = String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text || null
}

function parseNumber(value: unknown) {
  if (value === null || value === undefined) return null
  const original = String(value).trim()
  if (!original) return null
  const multiplier = /\bm\b|million/i.test(original) ? 1_000_000 : /\bk\b|thousand/i.test(original) ? 1_000 : 1
  const cleaned = original.replace(/[$,\s]/g, '').replace(/million|thousand/gi, '').replace(/[a-z]+$/i, '')
  if (!cleaned) return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed * multiplier : null
}

function parseInteger(value: unknown) {
  const parsed = parseNumber(value)
  return parsed === null ? null : Math.round(parsed)
}

function parseMoney(value: unknown) {
  const parsed = parseNumber(value)
  return parsed !== null && parsed >= 0 ? parsed : null
}

function parseRent(value: unknown) {
  const parsed = parseMoney(value)
  return parsed !== null && isReasonableMonthlyRent(parsed) ? parsed : null
}

export function detectSourceType(inputUrl: string | null | undefined): MarketSourceType {
  const url = String(inputUrl || '').toLowerCase()
  if (url.includes('zillow.')) return 'zillow'
  if (url.includes('crexi.')) return 'crexi'
  if (url.includes('loopnet.')) return 'loopnet'
  if (url.includes('redfin.')) return 'redfin'
  if (url.includes('realtor.')) return 'realtor'
  if (url.includes('apartments.')) return 'apartments'
  if (url.includes('investorlift.')) return 'investorlift'
  return 'manual_url'
}

function firstMatch(html: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match?.[1]) return cleanText(match[1])
  }
  return null
}

function findJsonLd(html: string) {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter(Boolean)
  const parsed: any[] = []
  for (const block of blocks) {
    try {
      const value = JSON.parse(block.trim())
      if (Array.isArray(value)) parsed.push(...value)
      else if (value?.['@graph'] && Array.isArray(value['@graph'])) parsed.push(...value['@graph'])
      else parsed.push(value)
    } catch {
      // Ignore malformed source JSON. Raw HTML remains in import job metadata.
    }
  }
  return parsed
}

function findNextData(html: string) {
  const match = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)
  if (!match?.[1]) return null
  try {
    return JSON.parse(match[1])
  } catch {
    return null
  }
}

function walk(value: unknown, visit: (key: string, value: unknown) => void, key = '') {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, key)
    return
  }
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    visit(childKey, childValue)
    walk(childValue, visit, childKey)
  }
}

function collectImages(html: string, jsonObjects: unknown[]) {
  const images = new Set<string>()
  for (const match of html.matchAll(/(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/gi)) {
    if (match[1]?.startsWith('http')) images.add(match[1])
  }
  for (const obj of jsonObjects) {
    walk(obj, (key, value) => {
      if (!/image|photo|img/i.test(key)) return
      if (typeof value === 'string' && value.startsWith('http')) images.add(value)
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string' && item.startsWith('http')) images.add(item)
          if (item && typeof item === 'object') {
            const url = (item as any).url || (item as any).contentUrl
            if (typeof url === 'string' && url.startsWith('http')) images.add(url)
          }
        }
      }
    })
  }
  return [...images].slice(0, 24)
}


function valueByKeyAliases(jsonObjects: unknown[], aliases: string[]) {
  const normalizedAliases = aliases.map((item) => item.toLowerCase())
  for (const obj of jsonObjects) {
    let found: unknown = null
    walk(obj, (key, value) => {
      if (found !== null && found !== undefined) return
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]+/g, '')
      if (normalizedAliases.some((alias) => normalizedKey === alias || normalizedKey.includes(alias))) {
        if (typeof value === 'string' || typeof value === 'number') found = value
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const candidate = (value as any).value || (value as any).amount || (value as any).price || (value as any).text || (value as any).name
          if (typeof candidate === 'string' || typeof candidate === 'number') found = candidate
        }
      }
    })
    if (found !== null && found !== undefined) return found
  }
  return null
}

function textFromJson(jsonObjects: unknown[], aliases: string[]) {
  return cleanText(valueByKeyAliases(jsonObjects, aliases))
}

function moneyFromJson(jsonObjects: unknown[], aliases: string[]) {
  return parseMoney(valueByKeyAliases(jsonObjects, aliases))
}

function numberFromJson(jsonObjects: unknown[], aliases: string[]) {
  return parseNumber(valueByKeyAliases(jsonObjects, aliases))
}

function extractMoneyByLabels(html: string, labels: string[]) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const patterns = [
      new RegExp(`${escaped}[^$0-9]{0,80}\\$?\\s*([0-9][0-9,.]{2,12})\\s*(?:m|k|million|thousand)?`, 'i'),
      new RegExp(`\\$?\\s*([0-9][0-9,.]{2,12})\\s*(?:m|k|million|thousand)?[^A-Za-z0-9]{0,40}${escaped}`, 'i'),
    ]
    for (const pattern of patterns) {
      const match = html.match(pattern)
      const value = parseMoney(match?.[1])
      if (value !== null) return value
    }
  }
  return null
}

export function buildFallbackNormalizedListing(inputUrl: string, sourceType: MarketSourceType, reason: string): NormalizedMarketListing {
  return {
    source_type: sourceType,
    external_listing_id: firstMatch(inputUrl, [/\/(?:deal|deals|deal-detail|deal-details|property|properties|property-detail|property-details|listing|listings)\/([A-Za-z0-9_-]{4,})/i, /[?&](?:id|dealId|propertyId|listingId)=([A-Za-z0-9_-]{4,})/i]),
    source_url: inputUrl,
    title: `${getMarketSourceAdapter(sourceType).label} listing pending review`,
    address: null,
    city: null,
    state: null,
    zip_code: null,
    county: null,
    property_type: null,
    units: 1,
    bedrooms: null,
    bathrooms: null,
    sqft: null,
    lot_size: null,
    year_built: null,
    list_price: null,
    asking_price: null,
    arv: null,
    rehab_estimate: null,
    current_rent: null,
    market_rent: null,
    hud_rent: null,
    estimated_rent: null,
    taxes_annual: null,
    insurance_annual: null,
    hoa_monthly: null,
    utilities_monthly: null,
    description: `Imported from ${getMarketSourceAdapter(sourceType).label}. Source details were not exposed to the server import and need manual review.`,
    broker_name: null,
    broker_phone: null,
    broker_email: null,
    primary_image_url: null,
    image_urls: [],
    raw_payload: {
      source: 'authorized_url_import_fallback',
      sourceType,
      sourceUrl: inputUrl,
      fetchedAt: new Date().toISOString(),
      importConfidence: 'low',
      reviewRequired: true,
      reason,
    },
  }
}

function extractFromStructuredData(jsonObjects: any[]) {
  const facts: Record<string, unknown> = {}
  for (const obj of jsonObjects) {
    walk(obj, (key, value) => {
      const lower = key.toLowerCase()
      if (facts[key] !== undefined) return
      if (['name', 'headline', 'description'].includes(lower) && typeof value === 'string') facts[key] = value
      if (['streetaddress', 'addresslocality', 'addressregion', 'postalcode'].includes(lower) && typeof value === 'string') facts[key] = value
      if (['price', 'pricevalue', 'amount'].includes(lower) && parseMoney(value) !== null) facts[key] = parseMoney(value)
      if (['numberofrooms', 'bedrooms', 'beds'].includes(lower) && parseNumber(value) !== null) facts[key] = parseNumber(value)
      if (['bathrooms', 'baths'].includes(lower) && parseNumber(value) !== null) facts[key] = parseNumber(value)
      if (['floorsize', 'livingarea', 'size'].includes(lower)) facts[key] = value
    })
  }
  return facts
}

function extractMonthlyRentFromHtml(html: string) {
  const rentPatterns = [
    /\$\s*([0-9][0-9,]{2,6})\s*(?:\/\s*mo|per\s+month|monthly)/i,
    /(?:monthlyRent|rentZestimate|rent|priceForRent)["'\s:]+\$?([0-9][0-9,]{2,6})/i,
  ]
  for (const pattern of rentPatterns) {
    const match = html.match(pattern)
    const rent = parseRent(match?.[1])
    if (rent !== null) return rent
  }
  return null
}

function extractSalePriceFromHtml(html: string, structuredPrice: number | null) {
  const salePatterns = [
    /(?:listPrice|price|askingPrice)["'\s:]+\$?([0-9][0-9,]{4,9})/i,
    /\$\s*([0-9][0-9,]{4,9})(?!\s*(?:\/\s*mo|per\s+month|monthly))/i,
  ]
  if (structuredPrice !== null && structuredPrice >= 10000) return structuredPrice
  for (const pattern of salePatterns) {
    const match = html.match(pattern)
    const price = parseMoney(match?.[1])
    if (price !== null && price >= 10000) return price
  }
  return null
}

function inferPropertyType(text: string) {
  return normalizePropertyType(firstMatch(text, [
    /\b(single family|duplex|triplex|fourplex|quadplex|multifamily|mixed use|retail|office|industrial|land|condo|townhouse)\b/i,
  ]))
}

function buildTitle(params: { title?: string | null; address?: string | null; city?: string | null; state?: string | null; sourceType: string }) {
  return params.title || [params.address, params.city, params.state].filter(Boolean).join(', ') || `${params.sourceType[0]?.toUpperCase()}${params.sourceType.slice(1)} opportunity`
}


export function isSearchResultsUrl(inputUrl: string | null | undefined) {
  const url = String(inputUrl || '').toLowerCase()
  if (!url.startsWith('http')) return false
  if (url.includes('investorlift.')) {
    if (/\/(?:deal|deals|deal-detail|deal-details|property|properties|property-detail|property-details|listing|listings)\/[a-z0-9_-]{4,}/i.test(url)) return false
    if (url.includes('/search') || url.includes('/inventory') || url.includes('/marketplace') || url.includes('/dashboard') || url.includes('/deals?') || url.includes('/properties?') || url.includes('/listings?')) return true
  }
  if (url.includes('searchquerystate=')) return true
  if (url.includes('/homes/') || url.includes('/for-sale/') || url.includes('/realestateandhomes-search/')) return true
  if (/\/[a-z-]+-[a-z]{2}\/?(?:\?|$)/i.test(url)) return true
  if (url.includes('/properties?') || url.includes('/search?') || url.includes('/commercial-real-estate/')) return true
  return false
}

function absoluteUrl(baseUrl: string, href: string) {
  try {
    return new URL(href, baseUrl).toString().split('#')[0]
  } catch {
    return null
  }
}

function listingUrlPatternsFor(sourceType: MarketSourceType) {
  if (sourceType === 'zillow') return [/href=["']([^"']*\/homedetails\/[^"']+?_zpid\/?[^"']*)["']/gi, /https?:\\?\/\\?\/www\.zillow\.com\\?\/homedetails\\?\/[^"'\\]+?_zpid\/?/gi]
  if (sourceType === 'redfin') return [/href=["']([^"']*\/[^"']+\/home\/[0-9]+[^"']*)["']/gi, /https?:\\?\/\\?\/www\.redfin\.com\\?\/[^"'\\]+?\\?\/home\\?\/[0-9]+/gi]
  if (sourceType === 'realtor') return [/href=["']([^"']*\/realestateandhomes-detail\/[^"']+)["']/gi, /https?:\\?\/\\?\/www\.realtor\.com\\?\/realestateandhomes-detail\\?\/[^"'\\]+/gi]
  if (sourceType === 'crexi') return [/href=["']([^"']*\/properties\/[0-9]+[^"']*)["']/gi, /https?:\\?\/\\?\/www\.crexi\.com\\?\/properties\\?\/[0-9]+[^"'\\]*/gi]
  if (sourceType === 'loopnet') return [/href=["']([^"']*\/Listing\/[^"']+\/[0-9]+\/?[^"']*)["']/gi, /https?:\\?\/\\?\/www\.loopnet\.com\\?\/Listing\\?\/[^"'\\]+?\\?\/[0-9]+/gi]
  if (sourceType === 'investorlift') return [/href=["']([^"']*\/(?:deal|deals|deal-detail|deal-details|property|properties|property-detail|property-details|listing|listings)\/[A-Za-z0-9_-]{4,}[^"']*)["']/gi, /https?:\\?\/\\?\/[^"'\\]*investorlift\.[^"'\\]+?\\?\/(?:deal|deals|deal-detail|deal-details|property|properties|property-detail|property-details|listing|listings)\\?\/[A-Za-z0-9_-]{4,}[^"'\\]*/gi, /["'](https?:\\?\/\\?\/[^"'\\]*investorlift\.[^"'\\]+?(?:deal|property|listing)[^"'\\]{6,})["']/gi]
  return [/href=["']([^"']*(?:homedetails|realestateandhomes-detail|\/home\/|\/properties\/|\/Listing\/)[^"']*)["']/gi]
}

function cleanDiscoveredUrl(raw: string, baseUrl: string) {
  const unescaped = raw
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .replace(/\\u002F/g, '/')
    .replace(/\\u0026/g, '&')
  return absoluteUrl(baseUrl, unescaped)
}

function isLikelyListingUrl(url: string, sourceType: MarketSourceType) {
  const value = url.toLowerCase()
  if (sourceType === 'zillow') return value.includes('/homedetails/') && value.includes('_zpid')
  if (sourceType === 'redfin') return value.includes('/home/')
  if (sourceType === 'realtor') return value.includes('/realestateandhomes-detail/')
  if (sourceType === 'crexi') return value.includes('/properties/')
  if (sourceType === 'loopnet') return value.includes('/listing/')
  if (sourceType === 'investorlift') return /\/(deal|deals|deal-detail|deal-details|property|properties|property-detail|property-details|listing|listings)\/[a-z0-9_-]{4,}/i.test(value) || /(?:dealid|propertyid|listingid|id)=([a-z0-9_-]{4,})/i.test(value)
  return value.includes('/homedetails/') || value.includes('/home/') || value.includes('/realestateandhomes-detail/') || value.includes('/properties/') || value.includes('/listing/')
}

export async function discoverListingUrlsFromSearchUrl(inputUrl: string, sourceTypeInput?: string | null, limit = SEARCH_DISCOVERY_LIMIT) {
  const sourceType = (sourceTypeInput && sourceTypeInput !== 'manual_url' ? sourceTypeInput : detectSourceType(inputUrl)) as MarketSourceType
  const adapter = getMarketSourceAdapter(sourceType)
  const hardLimit = Math.max(1, Math.min(Number(limit || SEARCH_DISCOVERY_LIMIT), SEARCH_DISCOVERY_LIMIT))
  let html = ''
  try {
    html = await fetchTextWithTimeout(inputUrl, {
      sourceType,
      mode: 'search',
      timeoutMs: SEARCH_DISCOVERY_TIMEOUT_MS,
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'user-agent': adapter.userAgent,
        ...(adapter.referrer ? { referer: adapter.referrer } : {}),
      },
    })
  } catch (error) {
    return [{
      url: inputUrl,
      sourceType,
      sourceUrl: inputUrl,
      order: 1,
      fallbackReason: error instanceof Error ? error.message : 'Source search page was not fetchable from the server',
    }]
  }

  const urls = new Set<string>()
  for (const pattern of listingUrlPatternsFor(sourceType)) {
    pattern.lastIndex = 0
    for (const match of html.matchAll(pattern)) {
      const raw = match[1] || match[0]
      const normalized = cleanDiscoveredUrl(raw, inputUrl)
      if (normalized && isLikelyListingUrl(normalized, sourceType)) urls.add(normalized)
      if (urls.size >= hardLimit) break
    }
    if (urls.size >= hardLimit) break
  }

  const discovered = [...urls].slice(0, hardLimit).map((url, index) => ({ url, sourceType, sourceUrl: inputUrl, order: index + 1 }))
  if (!discovered.length) {
    return [{
      url: inputUrl,
      sourceType,
      sourceUrl: inputUrl,
      order: 1,
      fallbackReason: 'No listing links were exposed in the source page HTML; importing the submitted URL for review instead.',
    }]
  }
  return discovered
}

export async function fetchAndNormalizeMarketUrl(inputUrl: string, sourceTypeInput?: string | null): Promise<NormalizedMarketListing> {
  const sourceType = (sourceTypeInput && !['manual', 'manual_url', 'other'].includes(String(sourceTypeInput)) ? sourceTypeInput : detectSourceType(inputUrl)) as MarketSourceType
  const adapter = getMarketSourceAdapter(sourceType)
  let html = ''
  try {
    html = await fetchTextWithTimeout(inputUrl, {
      sourceType,
      mode: 'listing',
      timeoutMs: LISTING_FETCH_TIMEOUT_MS,
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'user-agent': adapter.userAgent,
        ...(adapter.referrer ? { referer: adapter.referrer } : {}),
      },
    })
  } catch (error) {
    return buildFallbackNormalizedListing(inputUrl, sourceType, error instanceof Error ? error.message : 'Source did not return fetchable listing HTML')
  }

  const jsonLd = findJsonLd(html)
  const nextData = findNextData(html)
  const jsonObjects = [...jsonLd, nextData].filter(Boolean)
  const structuredFacts = extractFromStructuredData(jsonObjects)
  const images = collectImages(html, jsonObjects)

  const title = firstMatch(html, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i,
  ]) || cleanText(structuredFacts.name) || cleanText(structuredFacts.headline) || textFromJson(jsonObjects, ['title', 'headline', 'propertytitle', 'dealname', 'name'])

  const description = firstMatch(html, [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
  ]) || cleanText(structuredFacts.description) || textFromJson(jsonObjects, ['description', 'remarks', 'propertydescription', 'summary', 'investmenthighlights'])

  const address = cleanText(structuredFacts.streetAddress) || textFromJson(jsonObjects, ['streetaddress', 'addressline1', 'fulladdress', 'propertyaddress', 'address']) || firstMatch(html, [/"streetAddress"\s*:\s*"([^"]+)"/i])
  const city = cleanText(structuredFacts.addressLocality) || textFromJson(jsonObjects, ['addresslocality', 'city']) || firstMatch(html, [/"addressLocality"\s*:\s*"([^"]+)"/i])
  const state = cleanText(structuredFacts.addressRegion) || textFromJson(jsonObjects, ['addressregion', 'state', 'province']) || firstMatch(html, [/"addressRegion"\s*:\s*"([^"]+)"/i])
  const zip = cleanText(structuredFacts.postalCode) || textFromJson(jsonObjects, ['postalcode', 'zipcode', 'zip']) || firstMatch(html, [/"postalCode"\s*:\s*"([0-9]{5})"/i, /\b([0-9]{5})(?:-[0-9]{4})?\b/])
  const beds = numberFromJson(jsonObjects, ['bedrooms', 'beds', 'bedcount']) ?? parseNumber(firstMatch(html, [/([0-9]+(?:\.[0-9]+)?)\s*(?:bd|beds?|bedrooms?)\b/i]))
  const baths = numberFromJson(jsonObjects, ['bathrooms', 'baths', 'bathcount']) ?? parseNumber(firstMatch(html, [/([0-9]+(?:\.[0-9]+)?)\s*(?:ba|baths?|bathrooms?)\b/i]))
  const sqft = parseInteger(numberFromJson(jsonObjects, ['sqft', 'squarefeet', 'buildingarea', 'livingarea', 'floorsize']) ?? firstMatch(html, [/([0-9][0-9,]{2,6})\s*(?:sq\.?\s*ft|sqft|square feet)\b/i]))
  const units = parseInteger(numberFromJson(jsonObjects, ['units', 'doors', 'unitcount', 'numberofunits']) ?? firstMatch(html, [/([0-9]+)\s*(?:units?|doors?)\b/i])) || (inferPropertyType(`${title || ''} ${description || ''}`)?.includes('Duplex') ? 2 : null)
  const marketRent = parseRent(moneyFromJson(jsonObjects, ['marketrent', 'estimatedrent', 'rent', 'monthlyrent']) ?? extractMonthlyRentFromHtml(html))
  const structuredPrice = parseMoney(structuredFacts.price ?? structuredFacts.priceValue ?? structuredFacts.amount) ?? moneyFromJson(jsonObjects, ['askingprice', 'listprice', 'price', 'purchaseprice'])
  const listPrice = extractSalePriceFromHtml(html, structuredPrice)
  const taxesAnnual = moneyFromJson(jsonObjects, ['taxesannual', 'annualtaxes', 'propertytaxes', 'taxamount']) ?? extractMoneyByLabels(html, ['Taxes', 'Annual taxes', 'Property taxes'])
  const insuranceAnnual = moneyFromJson(jsonObjects, ['insuranceannual', 'annualinsurance', 'insurance']) ?? extractMoneyByLabels(html, ['Insurance', 'Annual insurance'])
  const hoaMonthly = moneyFromJson(jsonObjects, ['hoa', 'hoamonthly', 'associationfee']) ?? extractMoneyByLabels(html, ['HOA', 'Association fee'])
  const utilitiesMonthly = moneyFromJson(jsonObjects, ['utilities', 'utilitiesmonthly']) ?? extractMoneyByLabels(html, ['Utilities'])
  const arv = moneyFromJson(jsonObjects, ['arv', 'afterrepairvalue', 'afterrepairvalueestimate']) ?? extractMoneyByLabels(html, ['ARV', 'After Repair Value'])
  const rehabEstimate = moneyFromJson(jsonObjects, ['rehab', 'rehabestimate', 'repaircost', 'repairs']) ?? extractMoneyByLabels(html, ['Rehab', 'Repair estimate', 'Repairs'])

  return {
    source_type: sourceType,
    external_listing_id: firstMatch(inputUrl, adapter.listingIdPatterns) || firstMatch(html, adapter.listingIdPatterns) || firstMatch(html, [/"(?:zpid|listingId|propertyId|dealId|id)"\s*:\s*"?([A-Za-z0-9_-]{5,})"?/i]),
    source_url: inputUrl,
    title: buildTitle({ title, address, city, state, sourceType }),
    address,
    city,
    state,
    zip_code: zip,
    county: textFromJson(jsonObjects, ['county']),
    property_type: inferPropertyType(`${title || ''} ${description || ''}`) || textFromJson(jsonObjects, ['propertytype', 'assettype']),
    units,
    bedrooms: beds,
    bathrooms: baths,
    sqft,
    lot_size: textFromJson(jsonObjects, ['lotsize', 'lot']) || firstMatch(html, [/([0-9,.]+\s*(?:acre|acres|sqft lot|sf lot))/i]),
    year_built: parseInteger(numberFromJson(jsonObjects, ['yearbuilt', 'built']) ?? firstMatch(html, [/(?:built in|year built)[^0-9]{0,12}([12][0-9]{3})/i])),
    list_price: listPrice,
    asking_price: listPrice,
    arv,
    rehab_estimate: rehabEstimate,
    current_rent: marketRent,
    market_rent: marketRent,
    hud_rent: null,
    estimated_rent: marketRent,
    taxes_annual: taxesAnnual,
    insurance_annual: insuranceAnnual,
    hoa_monthly: hoaMonthly,
    utilities_monthly: utilitiesMonthly,
    description,
    broker_name: textFromJson(jsonObjects, ['brokername', 'agentname', 'contactname', 'ownername']) || firstMatch(html, [/(?:broker|agent|listed by)[^A-Za-z0-9]{0,20}([A-Z][A-Za-z .'-]{3,80})/i]),
    broker_phone: textFromJson(jsonObjects, ['brokerphone', 'agentphone', 'phone', 'contactphone']) || firstMatch(html, [/\b(\(?[0-9]{3}\)?[-.\s][0-9]{3}[-.\s][0-9]{4})\b/]),
    broker_email: textFromJson(jsonObjects, ['brokeremail', 'agentemail', 'email', 'contactemail']) || firstMatch(html, [/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i]),
    primary_image_url: images[0] || null,
    image_urls: images,
    raw_payload: {
      source: 'authorized_url_import',
      sourceType,
      adapter: adapter.label,
      fetchedAt: new Date().toISOString(),
      htmlLength: html.length,
      hasJsonLd: jsonLd.length > 0,
      hasNextData: Boolean(nextData),
      extractedFields: {
        hasTitle: Boolean(title),
        hasAddress: Boolean(address),
        hasListPrice: Boolean(listPrice),
        hasMarketRent: Boolean(marketRent),
        imageCount: images.length,
        hasTaxes: Boolean(taxesAnnual),
        hasArv: Boolean(arv),
        hasRehab: Boolean(rehabEstimate),
      },
    },
  }
}

function csvSplit(line: string) {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (char === ',' && !quoted) {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  cells.push(current.trim())
  return cells
}

function normalizeHeader(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

export function parseMarketCsvText(rawText: string, sourceType: MarketSourceType = 'csv'): NormalizedMarketListing[] {
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length < 2) return []
  const headers = csvSplit(lines[0]).map(normalizeHeader)
  return lines.slice(1).map((line, index) => {
    const values = csvSplit(line)
    const row: Record<string, string> = {}
    headers.forEach((header, headerIndex) => { row[header] = values[headerIndex] || '' })
    const imageUrls = String(row.image_urls || row.images || '').split(/[|;]+/).map((item) => item.trim()).filter((item) => item.startsWith('http')).slice(0, 24)
    const sourceUrl = cleanText(row.source_url || row.url || row.link)
    const detectedSource = sourceUrl ? detectSourceType(sourceUrl) : sourceType
    return {
      source_type: detectedSource,
      external_listing_id: cleanText(row.external_listing_id || row.listing_id || row.id),
      source_url: sourceUrl,
      title: cleanText(row.title) || cleanText(row.address) || `CSV opportunity ${index + 1}`,
      address: cleanText(row.address),
      city: cleanText(row.city),
      state: cleanText(row.state),
      zip_code: cleanText(row.zip || row.zip_code || row.postal_code),
      county: cleanText(row.county),
      property_type: normalizePropertyType(row.property_type || row.type),
      units: parseInteger(row.units || row.doors) || 1,
      bedrooms: parseNumber(row.bedrooms || row.beds),
      bathrooms: parseNumber(row.bathrooms || row.baths),
      sqft: parseInteger(row.sqft || row.square_feet),
      lot_size: cleanText(row.lot_size),
      year_built: parseInteger(row.year_built),
      list_price: parseMoney(row.list_price || row.price || row.asking_price),
      asking_price: parseMoney(row.asking_price || row.list_price || row.price),
      arv: parseMoney(row.arv),
      rehab_estimate: parseMoney(row.rehab_estimate || row.rehab),
      current_rent: parseRent(row.current_rent),
      market_rent: parseRent(row.market_rent || row.estimated_rent),
      hud_rent: parseRent(row.hud_rent || row.section8_rent || row.section_8_rent),
      estimated_rent: parseRent(row.estimated_rent || row.market_rent),
      taxes_annual: parseMoney(row.taxes_annual || row.taxes),
      insurance_annual: parseMoney(row.insurance_annual || row.insurance),
      hoa_monthly: parseMoney(row.hoa_monthly || row.hoa),
      utilities_monthly: parseMoney(row.utilities_monthly || row.utilities),
      description: cleanText(row.description || row.notes),
      broker_name: cleanText(row.broker_name || row.agent_name),
      broker_phone: cleanText(row.broker_phone || row.agent_phone),
      broker_email: cleanText(row.broker_email || row.agent_email),
      primary_image_url: cleanText(row.primary_image_url || row.image_url) || imageUrls[0] || null,
      image_urls: imageUrls,
      raw_payload: { source: 'csv_text_import', rowNumber: index + 2, row },
    }
  })
}

export function buildNormalizedListingKey(listing: Pick<NormalizedMarketListing, 'source_url' | 'external_listing_id' | 'address' | 'city' | 'state' | 'zip_code'>) {
  if (listing.source_url) return `url:${listing.source_url.toLowerCase()}`
  if (listing.external_listing_id) return `external:${listing.external_listing_id.toLowerCase()}`
  return `address:${[listing.address, listing.city, listing.state, listing.zip_code].filter(Boolean).join('|').toLowerCase()}`
}
