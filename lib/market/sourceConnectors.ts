import { normalizePropertyType } from '@/lib/market/scoring'
import { getMarketSourceAdapter } from '@/lib/market/sourceAdapters'
import { isReasonableMonthlyRent } from '@/lib/underwriting/rentIntelligence'

export type MarketSourceType = 'zillow' | 'investorlift' | 'crexi' | 'loopnet' | 'redfin' | 'realtor' | 'apartments' | 'csv' | 'partner_api' | 'mls_feed' | 'manual' | 'manual_url' | 'other'



const SEARCH_DISCOVERY_LIMIT = 40
const SEARCH_DISCOVERY_TIMEOUT_MS = 15000
const LISTING_FETCH_TIMEOUT_MS = 15000
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
    .replace(/\\u0026/g, '&')
    .replace(/\\u002F/g, '/')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text || null
}

function parseNumber(value: unknown) {
  if (value === null || value === undefined) return null
  let raw = String(value)
    .replace(/&nbsp;/g, ' ')
    .replace(/[,$]/g, '')
    .trim()
  if (!raw) return null

  const suffixMatch = raw.match(/(-?[0-9]+(?:\.[0-9]+)?)\s*([kKmMbB])\b/)
  if (suffixMatch) {
    const base = Number(suffixMatch[1])
    const suffix = suffixMatch[2].toLowerCase()
    if (!Number.isFinite(base)) return null
    const multiplier = suffix === 'k' ? 1_000 : suffix === 'm' ? 1_000_000 : 1_000_000_000
    return base * multiplier
  }

  const firstNumeric = raw.match(/-?[0-9]+(?:\.[0-9]+)?/)?.[0]
  if (!firstNumeric) return null
  const parsed = Number(firstNumeric)
  return Number.isFinite(parsed) ? parsed : null
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
  if (url.includes('investorlift.')) return 'investorlift'
  if (url.includes('crexi.')) return 'crexi'
  if (url.includes('loopnet.')) return 'loopnet'
  if (url.includes('redfin.')) return 'redfin'
  if (url.includes('realtor.')) return 'realtor'
  if (url.includes('apartments.')) return 'apartments'
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

function findEmbeddedJsonObjects(html: string) {
  const parsed: any[] = []
  const scriptBlocks = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1]?.trim())
    .filter(Boolean)
    .slice(0, 40)

  for (const block of scriptBlocks) {
    const candidates = [
      block,
      block?.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});?\s*$/i)?.[1],
      block?.match(/window\.__APOLLO_STATE__\s*=\s*({[\s\S]*?});?\s*$/i)?.[1],
      block?.match(/self\.__next_f\.push\(\[.*?,\s*"([\s\S]*?)"\]\)/i)?.[1],
    ].filter(Boolean)

    for (const candidate of candidates) {
      const cleaned = String(candidate)
        .replace(/\\"/g, '"')
        .replace(/\\u002F/g, '/')
        .replace(/\\u0026/g, '&')
        .trim()
      if (!cleaned.startsWith('{') && !cleaned.startsWith('[')) continue
      try {
        const value = JSON.parse(cleaned)
        if (Array.isArray(value)) parsed.push(...value)
        else parsed.push(value)
      } catch {
        // Ignore non-JSON scripts. HTML extraction remains available.
      }
    }
  }

  return parsed.slice(0, 20)
}

function normalKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function firstJsonValue(jsonObjects: unknown[], aliases: string[], predicate?: (value: unknown) => boolean) {
  const wanted = new Set(aliases.map(normalKey))
  let found: unknown = null
  for (const obj of jsonObjects) {
    walk(obj, (key, value) => {
      if (found !== null) return
      if (!wanted.has(normalKey(key))) return
      if (predicate && !predicate(value)) return
      found = value
    })
    if (found !== null) break
  }
  return found
}

function firstJsonText(jsonObjects: unknown[], aliases: string[]) {
  const value = firstJsonValue(jsonObjects, aliases, (item) => typeof item === 'string' && item.trim().length > 0)
  return cleanText(value)
}

function firstJsonMoney(jsonObjects: unknown[], aliases: string[]) {
  const value = firstJsonValue(jsonObjects, aliases, (item) => parseMoney(item) !== null)
  return parseMoney(value)
}

function firstJsonRent(jsonObjects: unknown[], aliases: string[]) {
  const value = firstJsonValue(jsonObjects, aliases, (item) => parseRent(item) !== null)
  return parseRent(value)
}

function firstJsonInteger(jsonObjects: unknown[], aliases: string[]) {
  const value = firstJsonValue(jsonObjects, aliases, (item) => parseInteger(item) !== null)
  return parseInteger(value)
}

function firstJsonNumber(jsonObjects: unknown[], aliases: string[]) {
  const value = firstJsonValue(jsonObjects, aliases, (item) => parseNumber(item) !== null)
  return parseNumber(value)
}

function jsonAddressPart(jsonObjects: unknown[], aliases: string[]) {
  return firstJsonText(jsonObjects, aliases)
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

function absoluteSourceUrl(baseUrl: string, href: string | null | undefined) {
  if (!href) return null
  const cleaned = href.replace(/\\u002F/g, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&').trim()
  if (!cleaned) return null
  try { return new URL(cleaned, baseUrl).toString().split('#')[0] } catch { return null }
}

function addImageUrl(images: Set<string>, baseUrl: string, value: unknown) {
  if (typeof value !== 'string') return
  const cleaned = value.replace(/\\u002F/g, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&')
  const urlCandidates = cleaned.match(/https?:[^"'\s)]+\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s)]*)?/gi) || [cleaned]
  for (const candidate of urlCandidates) {
    const absolute = absoluteSourceUrl(baseUrl, candidate)
    if (!absolute) continue
    if (/logo|icon|avatar|sprite|favicon/i.test(absolute)) continue
    images.add(absolute)
  }
}

function collectImages(html: string, jsonObjects: unknown[], baseUrl: string) {
  const images = new Set<string>()
  for (const match of html.matchAll(/(?:property|name)=["'](?:og:image|twitter:image|twitter:image:src)["'][^>]+content=["']([^"']+)["']/gi)) {
    addImageUrl(images, baseUrl, match[1])
  }
  for (const match of html.matchAll(/<img[^>]+(?:src|data-src|data-original|data-lazy-src)=["']([^"']+)["'][^>]*>/gi)) {
    addImageUrl(images, baseUrl, match[1])
  }
  for (const match of html.matchAll(/<source[^>]+srcset=["']([^"']+)["'][^>]*>/gi)) {
    String(match[1]).split(',').forEach((part) => addImageUrl(images, baseUrl, part.trim().split(/\s+/)[0]))
  }
  for (const match of html.matchAll(/srcset=["']([^"']+)["']/gi)) {
    String(match[1]).split(',').forEach((part) => addImageUrl(images, baseUrl, part.trim().split(/\s+/)[0]))
  }
  for (const obj of jsonObjects) {
    walk(obj, (key, value) => {
      if (/image|photo|picture|media|gallery|thumbnail|img/i.test(key)) {
        if (typeof value === 'string') addImageUrl(images, baseUrl, value)
        if (Array.isArray(value)) {
          for (const item of value) {
            if (typeof item === 'string') addImageUrl(images, baseUrl, item)
            if (item && typeof item === 'object') {
              const url = (item as any).url || (item as any).src || (item as any).href || (item as any).contentUrl || (item as any).mediaUrl
              addImageUrl(images, baseUrl, url)
            }
          }
        }
        if (value && typeof value === 'object') {
          const url = (value as any).url || (value as any).src || (value as any).href || (value as any).contentUrl || (value as any).mediaUrl
          addImageUrl(images, baseUrl, url)
        }
      }
      if (typeof value === 'string' && /https?:.*\.(?:jpg|jpeg|png|webp)/i.test(value)) addImageUrl(images, baseUrl, value)
    })
  }
  return [...images].slice(0, 24)
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
    /(?:listPrice|price|askingPrice)["'\s:]+\$?([0-9][0-9,.]{3,10}\s*[kKmMbB]?)/i,
    /\$\s*([0-9][0-9,.]{3,10}\s*[kKmMbB]?)(?!\s*(?:\/\s*mo|per\s+month|monthly))/i,
  ]
  if (structuredPrice !== null && structuredPrice >= 10000) return structuredPrice
  for (const pattern of salePatterns) {
    const match = html.match(pattern)
    const price = parseMoney(match?.[1])
    if (price !== null && price >= 10000) return price
  }
  return null
}

function extractLabeledMoneyFromHtml(html: string, labels: string[]) {
  const escaped = labels.map(escapeRegex).join('|')
  const patterns = [
    new RegExp(`(?:${escaped})[^$0-9]{0,120}\\$?\\s*([0-9][0-9,.]{1,10}\\s*[kKmMbB]?)`, 'i'),
    new RegExp(`"(?:${escaped})"\\s*:\\s*"?\\$?([0-9][0-9,.]{1,10}\\s*[kKmMbB]?)`, 'i'),
  ]
  for (const pattern of patterns) {
    const value = parseMoney(html.match(pattern)?.[1])
    if (value !== null) return value
  }
  return null
}

function extractAddressFromTitle(title: string | null, sourceType: string) {
  if (!title) return null
  const cleaned = title
    .replace(new RegExp(`${escapeRegex(sourceType)}\\s+(listing|opportunity|deal)`, 'i'), '')
    .replace(/\s*[-|]\s*(InvestorLift|Zillow|Redfin|Realtor\.com|Crexi|LoopNet).*$/i, '')
    .trim()
  if (/\d{1,6}\s+[A-Za-z0-9 .'-]+/.test(cleaned)) return cleaned
  return null
}

function isNonListingShell(params: { sourceType: string; title: string | null; address: string | null; listPrice: number | null; description: string | null }) {
  const text = `${params.title || ''} ${params.description || ''}`.toLowerCase()
  if ((params.address || params.listPrice) && !/sign\s*in|log\s*in|login|dashboard|app shell/.test(text)) return false
  if (params.sourceType === 'investorlift' && /sign\s*in|log\s*in|login|investorlift|javascript is disabled|enable javascript/.test(text)) return true
  return !params.address && !params.listPrice && /sign\s*in|log\s*in|login|enable javascript|captcha|access denied|forbidden/.test(text)
}

function fallbackListingFromUrl(inputUrl: string, sourceType: MarketSourceType, reason: string): NormalizedMarketListing {
  const adapter = getMarketSourceAdapter(sourceType)
  const url = (() => { try { return new URL(inputUrl) } catch { return null } })()
  const externalId = firstMatch(inputUrl, adapter.listingIdPatterns) || url?.searchParams.get('id') || url?.searchParams.get('propertyId') || url?.searchParams.get('listingId') || null
  return {
    source_type: sourceType,
    external_listing_id: externalId,
    source_url: inputUrl,
    title: `${adapter.label} listing`,
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
    description: `Imported from ${adapter.label}. DealFlowIQ could not read full provider details from the page, so this record was saved with the original source link and marked for enrichment/review.`,
    broker_name: null,
    broker_phone: null,
    broker_email: null,
    primary_image_url: null,
    image_urls: [],
    raw_payload: {
      source: 'authorized_url_import_fallback',
      sourceType,
      adapter: adapter.label,
      fetchedAt: new Date().toISOString(),
      extractionStatus: 'url_only_fallback',
      extractionWarning: reason,
      requiresManualReview: true,
    },
  }
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
  if (url.includes('investorlift.') && /\/(?:property|properties|property-detail|deal|deals|listing|listings|opportunity|opportunities)\/[^/?#]+/i.test(url)) return false
  if (url.includes('searchquerystate=')) return true
  if (url.includes('/homes/') || url.includes('/for-sale/') || url.includes('/realestateandhomes-search/')) return true
  if (/\/[a-z-]+-[a-z]{2}\/?(?:\?|$)/i.test(url)) return true
  if (url.includes('/properties?') || url.includes('/search?') || url.includes('/commercial-real-estate/')) return true
  if (url.includes('investorlift.') && (url.includes('/properties?') || url.includes('/deals?') || url.includes('/search') || url.includes('/marketplace') || url.includes('/inventory'))) return true
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
  if (sourceType === 'investorlift') return [/href=["']([^"']*(?:\/property\/|\/properties\/|\/property-detail\/|\/deal\/|\/deals\/|\/listing\/|\/listings\/|\/opportunity\/|\/opportunities\/)[^"']*)["']/gi, /https?:\\?\/\\?\/(?:[A-Za-z0-9.-]+\.)?investorlift\.com\\?\/(?:property|properties|property-detail|deal|deals|listing|listings|opportunity|opportunities)\\?\/[^"'\\]+/gi]
  if (sourceType === 'redfin') return [/href=["']([^"']*\/[^"']+\/home\/[0-9]+[^"']*)["']/gi, /https?:\\?\/\\?\/www\.redfin\.com\\?\/[^"'\\]+?\\?\/home\\?\/[0-9]+/gi]
  if (sourceType === 'realtor') return [/href=["']([^"']*\/realestateandhomes-detail\/[^"']+)["']/gi, /https?:\\?\/\\?\/www\.realtor\.com\\?\/realestateandhomes-detail\\?\/[^"'\\]+/gi]
  if (sourceType === 'crexi') return [/href=["']([^"']*\/properties\/[0-9]+[^"']*)["']/gi, /https?:\\?\/\\?\/www\.crexi\.com\\?\/properties\\?\/[0-9]+[^"'\\]*/gi]
  if (sourceType === 'loopnet') return [/href=["']([^"']*\/Listing\/[^"']+\/[0-9]+\/?[^"']*)["']/gi, /https?:\\?\/\\?\/www\.loopnet\.com\\?\/Listing\\?\/[^"'\\]+?\\?\/[0-9]+/gi]
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
  if (sourceType === 'investorlift') return (value.includes('/property/') || value.includes('/properties/') || value.includes('/property-detail/') || value.includes('/deal/') || value.includes('/deals/') || value.includes('/listing/') || value.includes('/listings/') || value.includes('/opportunity/') || value.includes('/opportunities/')) && !value.includes('/properties?') && !value.includes('/deals?')
  if (sourceType === 'redfin') return value.includes('/home/')
  if (sourceType === 'realtor') return value.includes('/realestateandhomes-detail/')
  if (sourceType === 'crexi') return value.includes('/properties/')
  if (sourceType === 'loopnet') return value.includes('/listing/')
  return value.includes('/homedetails/') || value.includes('/home/') || value.includes('/realestateandhomes-detail/') || value.includes('/properties/') || value.includes('/property/') || value.includes('/deals/') || value.includes('/deal/') || value.includes('/listing/')
}

export async function discoverListingUrlsFromSearchUrl(inputUrl: string, sourceTypeInput?: string | null, limit = SEARCH_DISCOVERY_LIMIT) {
  const sourceType = (sourceTypeInput && sourceTypeInput !== 'manual_url' ? sourceTypeInput : detectSourceType(inputUrl)) as MarketSourceType
  const adapter = getMarketSourceAdapter(sourceType)
  const hardLimit = Math.max(1, Math.min(Number(limit || SEARCH_DISCOVERY_LIMIT), SEARCH_DISCOVERY_LIMIT))
  const html = await fetchTextWithTimeout(inputUrl, {
    sourceType,
    mode: 'search',
    timeoutMs: SEARCH_DISCOVERY_TIMEOUT_MS,
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'user-agent': adapter.userAgent,
      ...(adapter.referrer ? { referer: adapter.referrer } : {}),
    },
  })

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

  return [...urls].slice(0, hardLimit).map((url, index) => ({ url, sourceType, sourceUrl: inputUrl, order: index + 1 }))
}


function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sourceSpecificMoney(html: string, labels: string[]) {
  const escaped = labels.map(escapeRegex).join('|')
  const patterns = [
    new RegExp(`(?:${escaped})[^$0-9]{0,80}\\$?\\s*([0-9][0-9,.]{1,10}\\s*[kKmMbB]?)`, 'i'),
    new RegExp(`"(?:${escaped})"\\s*:\\s*"?\\$?([0-9][0-9,.]{1,10}\\s*[kKmMbB]?)`, 'i'),
  ]
  for (const pattern of patterns) {
    const match = html.match(pattern)
    const value = parseMoney(match?.[1])
    if (value !== null) return value
  }
  return null
}

function sourceSpecificInteger(html: string, labels: string[]) {
  const escaped = labels.map(escapeRegex).join('|')
  const pattern = new RegExp(`(?:${escaped})[^0-9]{0,60}([0-9][0-9,]{0,5})`, 'i')
  return parseInteger(html.match(pattern)?.[1])
}

function investorLiftFields(html: string, jsonObjects: unknown[]) {
  return {
    arv: firstJsonMoney(jsonObjects, ['arv', 'afterRepairValue', 'after_repair_value']) || sourceSpecificMoney(html, ['arv', 'after repair value']),
    rehabEstimate: firstJsonMoney(jsonObjects, ['rehab', 'repairs', 'repairEstimate', 'estimatedRepairs', 'repair_estimate']) || sourceSpecificMoney(html, ['rehab', 'repairs', 'repair estimate', 'estimated repairs']),
    askingPrice: firstJsonMoney(jsonObjects, ['askingPrice', 'assignmentFee', 'purchasePrice', 'price', 'listPrice']) || sourceSpecificMoney(html, ['asking price', 'assignment fee', 'purchase price', 'price']),
    units: firstJsonInteger(jsonObjects, ['units', 'doors', 'unitCount', 'numberOfUnits']) || sourceSpecificInteger(html, ['units', 'doors']),
    taxesAnnual: firstJsonMoney(jsonObjects, ['taxesAnnual', 'annualTaxes', 'propertyTaxes', 'taxes', 'taxAmount']) || extractLabeledMoneyFromHtml(html, ['taxes', 'property taxes', 'annual taxes']),
    insuranceAnnual: firstJsonMoney(jsonObjects, ['insuranceAnnual', 'annualInsurance', 'insurance']) || extractLabeledMoneyFromHtml(html, ['insurance']),
    hoaMonthly: firstJsonMoney(jsonObjects, ['hoaMonthly', 'monthlyHoa', 'hoa']) || extractLabeledMoneyFromHtml(html, ['hoa', 'hoa monthly']),
  }
}

export async function fetchAndNormalizeMarketUrl(inputUrl: string, sourceTypeInput?: string | null): Promise<NormalizedMarketListing> {
  const sourceType = (sourceTypeInput && sourceTypeInput !== 'manual_url' ? sourceTypeInput : detectSourceType(inputUrl)) as MarketSourceType
  const adapter = getMarketSourceAdapter(sourceType)
  let html = ''
  try {
    html = await fetchTextWithTimeout(inputUrl, {
      sourceType,
      mode: 'listing',
      timeoutMs: LISTING_FETCH_TIMEOUT_MS,
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
        'user-agent': adapter.userAgent,
        ...(adapter.referrer ? { referer: adapter.referrer } : {}),
      },
    })
  } catch (error) {
    return fallbackListingFromUrl(inputUrl, sourceType, error instanceof Error ? error.message : 'Provider fetch failed')
  }

  const jsonLd = findJsonLd(html)
  const nextData = findNextData(html)
  const embeddedJson = findEmbeddedJsonObjects(html)
  const jsonObjects = [...jsonLd, nextData, ...embeddedJson].filter(Boolean)
  const structuredFacts = extractFromStructuredData(jsonObjects as any[])
  const images = collectImages(html, jsonObjects, inputUrl)

  const htmlTitle = firstMatch(html, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i,
  ])
  const title = htmlTitle || firstJsonText(jsonObjects, ['title', 'name', 'headline', 'propertyTitle', 'displayTitle']) || cleanText(structuredFacts.name) || cleanText(structuredFacts.headline)

  const description = firstMatch(html, [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
  ]) || firstJsonText(jsonObjects, ['description', 'propertyDescription', 'marketingDescription', 'publicRemarks', 'remarks', 'notes']) || cleanText(structuredFacts.description)

  const address = cleanText(structuredFacts.streetAddress)
    || jsonAddressPart(jsonObjects, ['streetAddress', 'street_address', 'address1', 'addressLine1', 'fullAddress', 'formattedAddress', 'displayAddress'])
    || firstMatch(html, [/"streetAddress"\s*:\s*"([^"]+)"/i, /"addressLine1"\s*:\s*"([^"]+)"/i])
    || extractAddressFromTitle(title, sourceType)
  const city = cleanText(structuredFacts.addressLocality) || jsonAddressPart(jsonObjects, ['addressLocality', 'city', 'municipality']) || firstMatch(html, [/"addressLocality"\s*:\s*"([^"]+)"/i, /"city"\s*:\s*"([^"]+)"/i])
  const state = cleanText(structuredFacts.addressRegion) || jsonAddressPart(jsonObjects, ['addressRegion', 'state', 'stateCode']) || firstMatch(html, [/"addressRegion"\s*:\s*"([^"]+)"/i, /"state"\s*:\s*"([A-Z]{2})"/i])
  const zip = cleanText(structuredFacts.postalCode) || jsonAddressPart(jsonObjects, ['postalCode', 'zip', 'zipCode', 'zipcode']) || firstMatch(html, [/"postalCode"\s*:\s*"([0-9]{5})"/i, /\b([0-9]{5})(?:-[0-9]{4})?\b/])
  const beds = firstJsonNumber(jsonObjects, ['bedrooms', 'beds', 'bedCount']) || parseNumber(firstMatch(html, [/([0-9]+(?:\.[0-9]+)?)\s*(?:bd|beds?|bedrooms?)\b/i]))
  const baths = firstJsonNumber(jsonObjects, ['bathrooms', 'baths', 'bathCount']) || parseNumber(firstMatch(html, [/([0-9]+(?:\.[0-9]+)?)\s*(?:ba|baths?|bathrooms?)\b/i]))
  const sqft = firstJsonInteger(jsonObjects, ['sqft', 'squareFeet', 'livingArea', 'buildingSize', 'floorSize']) || parseInteger(firstMatch(html, [/([0-9][0-9,]{2,6})\s*(?:sq\.?\s*ft|sqft|square feet)\b/i]))
  const typeText = firstJsonText(jsonObjects, ['propertyType', 'assetClass', 'homeType', 'type']) || `${title || ''} ${description || ''}`
  const units = firstJsonInteger(jsonObjects, ['units', 'doors', 'unitCount', 'numberOfUnits']) || parseInteger(firstMatch(html, [/([0-9]+)\s*(?:units?|doors?)\b/i])) || (inferPropertyType(typeText)?.includes('Duplex') ? 2 : null)
  const marketRent = firstJsonRent(jsonObjects, ['marketRent', 'estimatedRent', 'monthlyRent', 'rent', 'currentRent']) || extractMonthlyRentFromHtml(html)
  const structuredPrice = parseMoney(structuredFacts.price ?? structuredFacts.priceValue ?? structuredFacts.amount)
  const jsonListPrice = firstJsonMoney(jsonObjects, ['listPrice', 'askingPrice', 'price', 'purchasePrice'])
  const listPrice = jsonListPrice || extractSalePriceFromHtml(html, structuredPrice)
  const investorLift = sourceType === 'investorlift' ? investorLiftFields(html, jsonObjects) : { arv: null, rehabEstimate: null, askingPrice: null, units: null, taxesAnnual: null, insuranceAnnual: null, hoaMonthly: null }
  const effectiveListPrice = investorLift.askingPrice || listPrice
  const normalizedTitle = buildTitle({ title, address, city, state, sourceType })

  if (isNonListingShell({ sourceType, title: normalizedTitle, address, listPrice: effectiveListPrice, description })) {
    return fallbackListingFromUrl(inputUrl, sourceType, 'Provider returned an app/login shell instead of listing data. URL was saved for review, but no fields were fabricated.')
  }

  return {
    source_type: sourceType,
    external_listing_id: firstMatch(inputUrl, adapter.listingIdPatterns) || firstMatch(html, adapter.listingIdPatterns) || firstJsonText(jsonObjects, ['zpid', 'listingId', 'propertyId', 'dealId', 'id']) || firstMatch(html, [/"(?:zpid|listingId|propertyId|dealId|id)"\s*:\s*"?([A-Za-z0-9_-]{4,})"?/i]),
    source_url: inputUrl,
    title: normalizedTitle,
    address,
    city,
    state,
    zip_code: zip,
    county: firstJsonText(jsonObjects, ['county', 'countyName']),
    property_type: inferPropertyType(typeText),
    units: investorLift.units || units || 1,
    bedrooms: beds,
    bathrooms: baths,
    sqft,
    lot_size: firstJsonText(jsonObjects, ['lotSize', 'lot_size']) || firstMatch(html, [/([0-9,.]+\s*(?:acre|acres|sqft lot|sf lot))/i]),
    year_built: firstJsonInteger(jsonObjects, ['yearBuilt', 'builtYear']) || parseInteger(firstMatch(html, [/(?:built in|year built)[^0-9]{0,12}([12][0-9]{3})/i])),
    list_price: effectiveListPrice,
    asking_price: effectiveListPrice,
    arv: investorLift.arv || firstJsonMoney(jsonObjects, ['arv', 'afterRepairValue']),
    rehab_estimate: investorLift.rehabEstimate || firstJsonMoney(jsonObjects, ['rehabEstimate', 'repairEstimate', 'estimatedRepairs']),
    current_rent: firstJsonRent(jsonObjects, ['currentRent']) || marketRent,
    market_rent: marketRent,
    hud_rent: firstJsonRent(jsonObjects, ['hudRent', 'section8Rent', 'section_8_rent']),
    estimated_rent: firstJsonRent(jsonObjects, ['estimatedRent', 'rentEstimate']) || marketRent,
    taxes_annual: investorLift.taxesAnnual || firstJsonMoney(jsonObjects, ['taxesAnnual', 'annualTaxes', 'propertyTaxes', 'taxes', 'taxAmount']) || extractLabeledMoneyFromHtml(html, ['taxes', 'property taxes', 'annual taxes']),
    insurance_annual: investorLift.insuranceAnnual || firstJsonMoney(jsonObjects, ['insuranceAnnual', 'annualInsurance', 'insurance']) || extractLabeledMoneyFromHtml(html, ['insurance']),
    hoa_monthly: investorLift.hoaMonthly || firstJsonMoney(jsonObjects, ['hoaMonthly', 'monthlyHoa', 'hoa']) || extractLabeledMoneyFromHtml(html, ['hoa', 'hoa monthly']),
    utilities_monthly: firstJsonMoney(jsonObjects, ['utilitiesMonthly', 'monthlyUtilities', 'utilities']) || extractLabeledMoneyFromHtml(html, ['utilities']),
    description,
    broker_name: firstJsonText(jsonObjects, ['brokerName', 'agentName', 'contactName', 'sellerName', 'dispositionManager']) || firstMatch(html, [/(?:broker|agent|listed by|seller|contact)[^A-Za-z0-9]{0,20}([A-Z][A-Za-z .'-]{3,80})/i]),
    broker_phone: firstJsonText(jsonObjects, ['brokerPhone', 'agentPhone', 'phone', 'contactPhone']) || firstMatch(html, [/\b(\(?[0-9]{3}\)?[-.\s][0-9]{3}[-.\s][0-9]{4})\b/]),
    broker_email: firstJsonText(jsonObjects, ['brokerEmail', 'agentEmail', 'email', 'contactEmail']) || firstMatch(html, [/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i]),
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
      embeddedJsonBlocks: embeddedJson.length,
      extractionStatus: 'parsed',
      extractedFields: {
        hasTitle: Boolean(title),
        hasAddress: Boolean(address),
        hasListPrice: Boolean(effectiveListPrice),
        hasMarketRent: Boolean(marketRent),
        hasTaxes: Boolean(investorLift.taxesAnnual || firstJsonMoney(jsonObjects, ['taxesAnnual', 'annualTaxes', 'propertyTaxes', 'taxes', 'taxAmount'])),
        imageCount: images.length,
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
