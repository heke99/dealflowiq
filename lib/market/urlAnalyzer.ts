import { detectSourceType, type MarketSourceType } from '@/lib/market/sourceConnectors'
import { inferImportMode } from '@/lib/market/review'

type JsonRecord = Record<string, any>

export type MarketUrlAnalysis = {
  inputUrl: string
  normalizedUrl: string
  sourceType: MarketSourceType
  isSearchUrl: boolean
  isListingUrl: boolean
  importMode: string
  title: string
  summary: string
  targetCity: string | null
  targetState: string | null
  targetZip: string | null
  minPrice: number | null
  maxPrice: number | null
  mapBounds: JsonRecord | null
  category: string | null
  searchTerm: string | null
  regionId: string | null
  regionType: string | null
  parsed: JsonRecord
}

const US_STATE_BY_NAME: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
}

function safeUrl(value: string) {
  try { return new URL(value) } catch { return null }
}

function parseJson(value: string | null) {
  if (!value) return null
  try { return JSON.parse(value) } catch { return null }
}

function numberValue(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function titleCase(value: string) {
  return value.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()).trim()
}

function locationFromPath(pathname: string) {
  const parts = pathname.split('/').filter(Boolean)
  const first = decodeURIComponent(parts[0] || '').replace(/-homes-for-sale|-rentals|-real-estate|-oh-|_rb/i, '')
  const zip = first.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] || null
  const stateMatch = first.match(/(?:^|-)([a-z]{2})(?:-|$)/i)?.[1]?.toUpperCase() || null
  const withoutZip = first.replace(/\b\d{5}(?:-\d{4})?\b/g, '').replace(/(?:^|-)[a-z]{2}(?:-|$)/i, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return {
    city: withoutZip ? titleCase(withoutZip) : null,
    state: stateMatch,
    zip,
  }
}

function locationFromSearchTerm(term: string | null) {
  if (!term) return { city: null, state: null, zip: null }
  const zip = term.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] || null
  const stateAbbr = term.match(/\b([A-Z]{2})\b/)?.[1] || null
  const words = term.replace(/\b\d{5}(?:-\d{4})?\b/g, '').replace(/\b[A-Z]{2}\b/g, '').trim()
  return { city: words || null, state: stateAbbr, zip }
}

function getStateFromHostOrTerm(pathLocation: ReturnType<typeof locationFromPath>, searchTerm: string | null) {
  if (pathLocation.state) return pathLocation.state
  if (searchTerm) {
    const lower = searchTerm.toLowerCase()
    for (const [name, abbr] of Object.entries(US_STATE_BY_NAME)) {
      if (lower.includes(name)) return abbr
    }
  }
  return null
}

export function analyzeMarketUrl(inputUrl: string): MarketUrlAnalysis {
  const url = safeUrl(inputUrl.trim())
  if (!url || !['http:', 'https:'].includes(url.protocol)) throw new Error('Enter a valid http(s) URL.')

  const sourceType = detectSourceType(url.toString())
  const searchState = parseJson(url.searchParams.get('searchQueryState')) || parseJson(url.searchParams.get('search_query_state'))
  const zillowSearch = sourceType === 'zillow' && Boolean(searchState)
  const genericSearch = /search|forsale|for-sale|real-estate|homes-for-sale|map/i.test(url.pathname) || Boolean(url.searchParams.get('q') || url.searchParams.get('location'))
  const isSearchUrl = Boolean(zillowSearch || genericSearch)
  const isListingUrl = !isSearchUrl && /homedetails|property|listing|real-estate\//i.test(url.pathname)

  const filterState = (searchState?.filterState || {}) as JsonRecord
  const price = (filterState.price || filterState.priceFilter || {}) as JsonRecord
  const searchTerm = searchState?.usersSearchTerm || url.searchParams.get('location') || url.searchParams.get('q') || null
  const pathLocation = locationFromPath(url.pathname)
  const termLocation = locationFromSearchTerm(searchTerm)
  const targetCity = termLocation.city || pathLocation.city
  const targetState = termLocation.state || getStateFromHostOrTerm(pathLocation, searchTerm)
  const targetZip = termLocation.zip || pathLocation.zip
  const region = Array.isArray(searchState?.regionSelection) ? searchState.regionSelection[0] : null
  const minPrice = numberValue(price.min)
  const maxPrice = numberValue(price.max)
  const mapBounds = searchState?.mapBounds && typeof searchState.mapBounds === 'object' ? searchState.mapBounds : null
  const category = searchState?.category || (url.pathname.includes('rent') ? 'rentals' : sourceType === 'zillow' ? 'for_sale' : null)
  const importMode = inferImportMode(sourceType, isSearchUrl)
  const titleLocation = [targetCity, targetState, targetZip].filter(Boolean).join(' ')
  const title = isSearchUrl ? `${sourceType.toUpperCase()} search import${titleLocation ? ` · ${titleLocation}` : ''}` : `${sourceType.toUpperCase()} listing import`
  const priceText = maxPrice ? ` up to $${Math.round(maxPrice).toLocaleString('en-US')}` : ''
  const summary = isSearchUrl
    ? `Ready to queue an authorized ${sourceType} search${titleLocation ? ` for ${titleLocation}` : ''}${priceText}. Add listing URLs, CSV/API data, or approved feed output to create scored deals.`
    : `Ready to import and score one authorized ${sourceType} listing URL.`

  return {
    inputUrl,
    normalizedUrl: url.toString(),
    sourceType,
    isSearchUrl,
    isListingUrl,
    importMode,
    title,
    summary,
    targetCity,
    targetState,
    targetZip,
    minPrice,
    maxPrice,
    mapBounds,
    category,
    searchTerm,
    regionId: region?.regionId ? String(region.regionId) : null,
    regionType: region?.regionType ? String(region.regionType) : null,
    parsed: {
      host: url.hostname,
      pathname: url.pathname,
      sourceType,
      importMode,
      searchQueryState: searchState || null,
      filterState,
      price,
      regionSelection: region || null,
    },
  }
}
