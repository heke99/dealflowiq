export type ZillowRentalImport = {
  sourceUrl: string
  sourceName: string
  externalListingId: string | null
  compAddress: string | null
  city: string | null
  state: string | null
  zipCode: string | null
  bedrooms: number | null
  bathrooms: number | null
  squareFeet: number | null
  monthlyRent: number | null
  listingDate: string | null
  notes: string | null
  raw: Record<string, unknown>
}

const USER_AGENT =
  process.env.ZILLOW_USER_AGENT ||
  'DealFlowIQ/1.0 (+https://dealflowiq.com; authorized Zillow import)'

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(String(value).replace(/[$,\s]/g, ''))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function isReasonableMonthlyRent(value: unknown): value is number {
  const num = typeof value === 'number' ? value : toNumber(value)
  return typeof num === 'number' && Number.isFinite(num) && num >= 250 && num <= 50000
}

function clean(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const normalized = String(value).replace(/\s+/g, ' ').trim()
  return normalized || null
}

function first<T>(...values: Array<T | null | undefined>): T | null {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') return value as T
  }
  return null
}

function safeJsonParse(value: string): unknown | null {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function walk(obj: unknown, visit: (value: unknown, path: string[]) => void, path: string[] = []) {
  visit(obj, path)
  if (!obj || typeof obj !== 'object') return
  if (Array.isArray(obj)) {
    obj.forEach((item, index) => walk(item, visit, [...path, String(index)]))
    return
  }
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    walk(value, visit, [...path, key])
  }
}

function findKey(obj: unknown, names: string[]): unknown {
  let found: unknown
  const targets = new Set(names.map((name) => name.toLowerCase()))
  walk(obj, (value, path) => {
    if (found !== undefined) return
    const key = path[path.length - 1]?.toLowerCase()
    if (key && targets.has(key) && value !== null && value !== undefined && value !== '') found = value
  })
  return found
}

function collectJsonLd(html: string): unknown[] {
  const matches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
  return matches.map((match) => safeJsonParse(match[1].trim())).filter(Boolean) as unknown[]
}

function extractNextData(html: string): unknown | null {
  const match = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)
  return match ? safeJsonParse(match[1].trim()) : null
}

function textMatch(html: string, pattern: RegExp): string | null {
  const match = html.match(pattern)
  return clean(match?.[1])
}

function numericTextMatch(html: string, pattern: RegExp): number | null {
  return toNumber(textMatch(html, pattern))
}

function normalizeAddressFromObject(raw: unknown) {
  const address = findKey(raw, ['streetAddress', 'addressLine1', 'address'])
  const addressObj = typeof address === 'object' && address ? address as Record<string, unknown> : null
  return {
    street: clean(addressObj?.streetAddress ?? addressObj?.addressLine1 ?? (typeof address === 'string' ? address : null)),
    city: clean(addressObj?.addressLocality ?? findKey(raw, ['city', 'addressLocality'])),
    state: clean(addressObj?.addressRegion ?? findKey(raw, ['state', 'addressRegion'])),
    zip: clean(addressObj?.postalCode ?? findKey(raw, ['zipcode', 'zipCode', 'postalCode'])),
  }
}

function normalizeFromPayload(sourceUrl: string, payloads: unknown[], html: string): ZillowRentalImport {
  const combined = payloads.length === 1 ? payloads[0] : { payloads }
  const address = normalizeAddressFromObject(combined)

  // Only use rent-specific signals. Do not use generic `price` or sale values as monthly rent.
  const explicitRentText = first(
    textMatch(html, /\$([0-9][0-9,]*)\s*(?:\/mo|per month|mo)/i),
    textMatch(html, /"(?:monthlyRent|rent|rentZestimate)"\s*:\s*"?\$?([0-9][0-9,]*)/i)
  )
  const rentCandidate = first(
    findKey(combined, ['monthlyRent', 'rent', 'rentZestimate']),
    explicitRentText
  )

  const parsedRent = toNumber(rentCandidate)
  const rent = isReasonableMonthlyRent(parsedRent) ? parsedRent : null
  const beds = first(findKey(combined, ['bedrooms', 'beds']), numericTextMatch(html, /([0-9]+(?:\.[0-9]+)?)\s*(?:bd|beds?|bedrooms?)/i))
  const baths = first(findKey(combined, ['bathrooms', 'baths']), numericTextMatch(html, /([0-9]+(?:\.[0-9]+)?)\s*(?:ba|baths?|bathrooms?)/i))
  const sqft = first(findKey(combined, ['livingArea', 'livingAreaValue', 'floorSize', 'sqft']), numericTextMatch(html, /([0-9][0-9,]*)\s*(?:sqft|sq\.\s*ft\.)/i))

  return {
    sourceUrl,
    sourceName: 'Zillow',
    externalListingId: clean(first(findKey(combined, ['zpid', 'listingId', 'homeId']), textMatch(sourceUrl, /\/(\d+)_zpid/i))),
    compAddress: address.street,
    city: address.city,
    state: address.state,
    zipCode: address.zip,
    bedrooms: toNumber(beds),
    bathrooms: toNumber(baths),
    squareFeet: toNumber(sqft) ? Math.round(toNumber(sqft) as number) : null,
    monthlyRent: rent,
    listingDate: clean(findKey(combined, ['datePosted', 'listingDate', 'postingDate'])),
    notes: 'Imported directly from Zillow page HTML using authorized DealFlowIQ integration. Generic sale/list price is intentionally ignored; verify monthly rent before underwriting.',
    raw: {
      extractedAt: new Date().toISOString(),
      payloadCount: payloads.length,
      hasNextData: Boolean(payloads.find((payload) => payload && typeof payload === 'object' && 'props' in (payload as Record<string, unknown>))),
    },
  }
}

export async function importZillowRentalByUrl(sourceUrl: string): Promise<ZillowRentalImport> {
  let url: URL
  try {
    url = new URL(sourceUrl)
  } catch {
    throw new Error('Enter a valid Zillow URL.')
  }

  if (!/zillow\.com$/i.test(url.hostname.replace(/^www\./, '')) && !url.hostname.endsWith('.zillow.com')) {
    throw new Error('This importer only accepts Zillow URLs.')
  }

  const response = await fetch(url.toString(), {
    cache: 'no-store',
    headers: {
      'user-agent': USER_AGENT,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  })

  if (!response.ok) {
    throw new Error(`Zillow import failed (${response.status}). If Zillow blocks the request, paste the comp manually or connect an approved data feed.`)
  }

  const html = await response.text()
  const payloads = [...collectJsonLd(html)]
  const nextData = extractNextData(html)
  if (nextData) payloads.push(nextData)

  const imported = normalizeFromPayload(url.toString(), payloads, html)
  if (!imported.monthlyRent) {
    throw new Error('Zillow page was fetched, but a reasonable monthly rent could not be extracted. Add the rent manually and keep the Zillow URL as source evidence. DealFlowIQ ignores generic sale/list prices to avoid bad market-rent calculations.')
  }
  return imported
}
