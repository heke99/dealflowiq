import { normalizePropertyType } from '@/lib/market/scoring'
import { getMarketSourceAdapter } from '@/lib/market/sourceAdapters'
import { isReasonableMonthlyRent } from '@/lib/underwriting/rentIntelligence'

export type MarketSourceType = 'zillow' | 'crexi' | 'loopnet' | 'redfin' | 'realtor' | 'apartments' | 'csv' | 'partner_api' | 'mls_feed' | 'manual' | 'manual_url' | 'other'

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
  const raw = String(value).replace(/[$,\s]/g, '').trim()
  if (!raw) return null
  const parsed = Number(raw)
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
  return [...images].slice(0, 12)
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

export async function fetchAndNormalizeMarketUrl(inputUrl: string, sourceTypeInput?: string | null): Promise<NormalizedMarketListing> {
  const sourceType = (sourceTypeInput && sourceTypeInput !== 'manual_url' ? sourceTypeInput : detectSourceType(inputUrl)) as MarketSourceType
  const adapter = getMarketSourceAdapter(sourceType)
  const response = await fetch(inputUrl, {
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'user-agent': adapter.userAgent,
      ...(adapter.referrer ? { referer: adapter.referrer } : {}),
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`${sourceType} import returned HTTP ${response.status}. Use authorized access/API or paste the listing manually if the source blocks server fetch.`)
  }

  const html = await response.text()
  const jsonLd = findJsonLd(html)
  const nextData = findNextData(html)
  const structuredFacts = extractFromStructuredData([...jsonLd, nextData].filter(Boolean))
  const images = collectImages(html, [...jsonLd, nextData].filter(Boolean))

  const title = firstMatch(html, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i,
  ]) || cleanText(structuredFacts.name) || cleanText(structuredFacts.headline)

  const description = firstMatch(html, [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
  ]) || cleanText(structuredFacts.description)

  const address = cleanText(structuredFacts.streetAddress) || firstMatch(html, [/"streetAddress"\s*:\s*"([^"]+)"/i])
  const city = cleanText(structuredFacts.addressLocality) || firstMatch(html, [/"addressLocality"\s*:\s*"([^"]+)"/i])
  const state = cleanText(structuredFacts.addressRegion) || firstMatch(html, [/"addressRegion"\s*:\s*"([^"]+)"/i])
  const zip = cleanText(structuredFacts.postalCode) || firstMatch(html, [/"postalCode"\s*:\s*"([0-9]{5})"/i, /\b([0-9]{5})(?:-[0-9]{4})?\b/])
  const beds = parseNumber(firstMatch(html, [/([0-9]+(?:\.[0-9]+)?)\s*(?:bd|beds?|bedrooms?)\b/i]))
  const baths = parseNumber(firstMatch(html, [/([0-9]+(?:\.[0-9]+)?)\s*(?:ba|baths?|bathrooms?)\b/i]))
  const sqft = parseInteger(firstMatch(html, [/([0-9][0-9,]{2,6})\s*(?:sq\.?\s*ft|sqft|square feet)\b/i]))
  const units = parseInteger(firstMatch(html, [/([0-9]+)\s*(?:units?|doors?)\b/i])) || (inferPropertyType(`${title || ''} ${description || ''}`)?.includes('Duplex') ? 2 : null)
  const marketRent = extractMonthlyRentFromHtml(html)
  const structuredPrice = parseMoney(structuredFacts.price ?? structuredFacts.priceValue ?? structuredFacts.amount)
  const listPrice = extractSalePriceFromHtml(html, structuredPrice)

  return {
    source_type: sourceType,
    external_listing_id: firstMatch(inputUrl, adapter.listingIdPatterns) || firstMatch(html, adapter.listingIdPatterns) || firstMatch(html, [/"(?:zpid|listingId|propertyId|id)"\s*:\s*"?([A-Za-z0-9_-]{5,})"?/i]),
    source_url: inputUrl,
    title: buildTitle({ title, address, city, state, sourceType }),
    address,
    city,
    state,
    zip_code: zip,
    county: null,
    property_type: inferPropertyType(`${title || ''} ${description || ''}`),
    units,
    bedrooms: beds,
    bathrooms: baths,
    sqft,
    lot_size: firstMatch(html, [/([0-9,.]+\s*(?:acre|acres|sqft lot|sf lot))/i]),
    year_built: parseInteger(firstMatch(html, [/(?:built in|year built)[^0-9]{0,12}([12][0-9]{3})/i])),
    list_price: listPrice,
    asking_price: listPrice,
    arv: null,
    rehab_estimate: null,
    current_rent: marketRent,
    market_rent: marketRent,
    hud_rent: null,
    estimated_rent: marketRent,
    taxes_annual: null,
    insurance_annual: null,
    hoa_monthly: null,
    utilities_monthly: null,
    description,
    broker_name: firstMatch(html, [/(?:broker|agent|listed by)[^A-Za-z0-9]{0,20}([A-Z][A-Za-z .'-]{3,80})/i]),
    broker_phone: firstMatch(html, [/\b(\(?[0-9]{3}\)?[-.\s][0-9]{3}[-.\s][0-9]{4})\b/]),
    broker_email: firstMatch(html, [/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i]),
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
      },
    },
  }
}


function isLikelyListingUrl(inputUrl: string, sourceType: MarketSourceType) {
  const url = inputUrl.toLowerCase()
  if (sourceType === 'zillow') return url.includes('/homedetails/') || url.includes('_zpid')
  if (sourceType === 'redfin') return url.includes('/home/')
  if (sourceType === 'realtor') return url.includes('/realestateandhomes-detail/') || url.includes('/homedetail/')
  if (sourceType === 'crexi') return url.includes('/properties/') || url.includes('/lease/properties/')
  if (sourceType === 'loopnet') return url.includes('/listing/')
  return !url.includes('search') && !url.includes('searchquerystate')
}

function absoluteUrl(candidate: string, baseUrl: string) {
  try {
    return new URL(candidate, baseUrl).toString().split('#')[0]
  } catch {
    return null
  }
}

function providerHostPattern(sourceType: MarketSourceType) {
  if (sourceType === 'zillow') return /zillow\.com/i
  if (sourceType === 'redfin') return /redfin\.com/i
  if (sourceType === 'realtor') return /realtor\.com/i
  if (sourceType === 'crexi') return /crexi\.com/i
  if (sourceType === 'loopnet') return /loopnet\.com/i
  return /./i
}

function looksLikeProviderListingUrl(url: string, sourceType: MarketSourceType) {
  const lower = url.toLowerCase()
  if (!providerHostPattern(sourceType).test(lower)) return false
  if (sourceType === 'zillow') return lower.includes('/homedetails/') || lower.includes('_zpid')
  if (sourceType === 'redfin') return lower.includes('/home/')
  if (sourceType === 'realtor') return lower.includes('/realestateandhomes-detail/') || lower.includes('/realestateandhomes-search') === false && lower.includes('/realestateandhomes')
  if (sourceType === 'crexi') return lower.includes('/properties/')
  if (sourceType === 'loopnet') return lower.includes('/listing/')
  return lower.startsWith('http')
}

function collectListingUrlsFromSearchHtml(html: string, baseUrl: string, sourceType: MarketSourceType, limit: number) {
  const decodedHtml = html
    .replace(/\\u002F/g, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
  const candidates = new Set<string>()
  for (const match of decodedHtml.matchAll(/href=["']([^"']+)["']/gi)) {
    const url = absoluteUrl(match[1], baseUrl)
    if (url) candidates.add(url)
  }
  const rawPatterns = [
    new RegExp('https?:\\?/\\?/[^\"\'<>\\s]+', 'gi'),
    new RegExp('/(?:homedetails|realestateandhomes-detail|properties|Listing)/[^\"\'<>\\s]+', 'gi'),
    new RegExp('/[^\"\'<>\\s]+/home/[^\"\'<>\\s]+', 'gi'),
  ]
  for (const pattern of rawPatterns) {
    for (const match of decodedHtml.matchAll(pattern)) {
      const cleaned = match[0].replace(/\\/g, '')
      const url = absoluteUrl(cleaned, baseUrl)
      if (url) candidates.add(url)
    }
  }
  return [...candidates]
    .map((url) => url.split('?')[0])
    .filter((url, index, arr) => arr.indexOf(url) === index)
    .filter((url) => looksLikeProviderListingUrl(url, sourceType))
    .slice(0, limit)
}

export async function fetchMarketImportPreview(inputUrl: string, sourceTypeInput?: string | null, limit = 10): Promise<NormalizedMarketListing[]> {
  const sourceType = (sourceTypeInput && sourceTypeInput !== 'manual_url' ? sourceTypeInput : detectSourceType(inputUrl)) as MarketSourceType
  if (isLikelyListingUrl(inputUrl, sourceType)) {
    return [await fetchAndNormalizeMarketUrl(inputUrl, sourceType)]
  }

  const adapter = getMarketSourceAdapter(sourceType)
  const response = await fetch(inputUrl, {
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'user-agent': adapter.userAgent,
      ...(adapter.referrer ? { referer: adapter.referrer } : {}),
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`${sourceType} search import returned HTTP ${response.status}. The provider did not return a readable search page to this server.`)
  }

  const html = await response.text()
  const urls = collectListingUrlsFromSearchHtml(html, inputUrl, sourceType, limit)
  if (!urls.length) {
    throw new Error(`No listing URLs were found on this ${sourceType} search page. Try a direct listing URL or verify the authorized page returns listing links to the server.`)
  }

  const listings: NormalizedMarketListing[] = []
  const errors: string[] = []
  for (const url of urls) {
    try {
      listings.push(await fetchAndNormalizeMarketUrl(url, sourceType))
    } catch (error) {
      errors.push(`${url}: ${error instanceof Error ? error.message : 'Could not read listing'}`)
      listings.push({
        source_type: sourceType,
        external_listing_id: firstMatch(url, adapter.listingIdPatterns),
        source_url: url,
        title: `${adapter.label} listing needs review`,
        address: null,
        city: null,
        state: null,
        zip_code: null,
        county: null,
        property_type: normalizePropertyType(adapter.category === 'commercial' ? 'commercial' : 'single_family'),
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
        description: null,
        broker_name: null,
        broker_phone: null,
        broker_email: null,
        primary_image_url: null,
        image_urls: [],
        raw_payload: { source: 'authorized_search_import_placeholder', sourceType, searchUrl: inputUrl, previewError: errors.at(-1), importedAt: new Date().toISOString() },
      })
    }
  }
  return listings
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
    const imageUrls = String(row.image_urls || row.images || '').split(/[|;]+/).map((item) => item.trim()).filter((item) => item.startsWith('http')).slice(0, 12)
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
