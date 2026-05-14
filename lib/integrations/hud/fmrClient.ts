export type HudYearMode = 'auto' | 'manual'

export type HudFmrResult = {
  zipCode: string
  hudYear: number
  hudYearMode: HudYearMode
  attemptedYears: Array<number | 'latest'>
  state?: string | null
  county?: string | null
  metroArea?: string | null
  entityId?: string | null
  entitySource?: string | null
  rents: {
    0: number | null
    1: number | null
    2: number | null
    3: number | null
    4: number | null
  }
  selectedBedroomRent: number | null
  sourceUrl: string
  raw: unknown
}

type LookupParams = {
  zipCode: string
  bedrooms?: number | null
  hudYear?: number | 'auto' | null
}

type CandidateYear = number | 'latest'

type HudEntityCandidate = {
  entityId: string
  source: 'zip_cbsa_metro' | 'zip_county' | 'custom_template' | 'direct_zip'
  label?: string | null
  ratio?: number
}

export const HUDUSER_MIN_LOOKBACK_YEAR = 2020

const DEFAULT_FMR_BASE_URL = 'https://www.huduser.gov/hudapi/public/fmr'
const DEFAULT_USPS_BASE_URL = 'https://www.huduser.gov/hudapi/public/usps'

export function getHudConfiguredDefaultYear(): number | null {
  const forced = Number(process.env.HUDUSER_FORCE_YEAR || '')
  if (Number.isFinite(forced) && forced >= HUDUSER_MIN_LOOKBACK_YEAR) return Math.round(forced)

  const configured = String(process.env.HUDUSER_DEFAULT_YEAR || 'auto').trim().toLowerCase()
  if (!configured || configured === 'auto' || configured === 'latest') return null

  const parsed = Number(configured)
  return Number.isFinite(parsed) && parsed >= HUDUSER_MIN_LOOKBACK_YEAR ? Math.round(parsed) : null
}

export function getHudCandidateYears(explicitYear?: number | 'auto' | null): CandidateYear[] {
  if (typeof explicitYear === 'number' && Number.isFinite(explicitYear) && explicitYear >= HUDUSER_MIN_LOOKBACK_YEAR) {
    return [Math.round(explicitYear)]
  }

  const configured = getHudConfiguredDefaultYear()
  if (configured) return [configured]

  // HUD says year is optional and defaults to latest. Use that first, then fall back by year.
  const currentYear = new Date().getFullYear()
  const years: CandidateYear[] = ['latest']
  for (let year = currentYear + 1; year >= HUDUSER_MIN_LOOKBACK_YEAR; year -= 1) years.push(year)
  return years
}

function fmrBaseUrl() {
  return (process.env.HUDUSER_FMR_API_BASE_URL || DEFAULT_FMR_BASE_URL).replace(/\/$/, '')
}

function uspsBaseUrl() {
  return (process.env.HUDUSER_USPS_API_BASE_URL || DEFAULT_USPS_BASE_URL).replace(/\/$/, '')
}

function endpoint(path: string) {
  const base = fmrBaseUrl()
  if (base.endsWith('/fmr/data') && path.startsWith('/data/')) {
    return `${base}${path.replace(/^\/data/, '')}`
  }
  if (base.endsWith('/fmr') || base === DEFAULT_FMR_BASE_URL) return `${base}${path}`
  return `${base}${path}`
}

function buildCustomTemplateUrl(zipCode: string, hudYear: CandidateYear) {
  const template = process.env.HUDUSER_FMR_LOOKUP_URL_TEMPLATE || ''
  if (!template) return null
  return template
    .replaceAll('{zip}', encodeURIComponent(zipCode))
    .replaceAll('{year}', hudYear === 'latest' ? '' : String(hudYear))
}

function buildFmrDataUrl(entityId: string, hudYear: CandidateYear) {
  const url = new URL(endpoint(`/data/${encodeURIComponent(entityId)}`))
  if (hudYear !== 'latest') url.searchParams.set('year', String(hudYear))
  return url.toString()
}

function buildUspsUrl(type: 2 | 3, zipCode: string) {
  const url = new URL(uspsBaseUrl())
  url.searchParams.set('type', String(type))
  url.searchParams.set('query', zipCode)
  return url.toString()
}

function buildMetroListUrl() {
  return endpoint('/listMetroAreas')
}

function headers(): Record<string, string> {
  const token = process.env.HUDUSER_API_TOKEN || process.env.HUD_USER_API_TOKEN
  const result: Record<string, string> = { Accept: 'application/json' }
  if (token) result.Authorization = `Bearer ${token}`
  return result
}

async function fetchJson(url: string) {
  const response = await fetch(url, { headers: headers(), cache: 'no-store' })
  if (!response.ok) {
    let message = `${response.status}`
    try {
      const text = await response.text()
      if (text) message = `${response.status}: ${text.slice(0, 220)}`
    } catch {}
    throw new Error(message)
  }
  return response.json()
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const cleaned = String(value).replace(/[$,]/g, '').trim()
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function findFirst(obj: unknown, keys: string[]): unknown {
  if (!obj || typeof obj !== 'object') return undefined
  const record = obj as Record<string, unknown>
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key]
  }
  for (const value of Object.values(record)) {
    const found = findFirst(value, keys)
    if (found !== undefined && found !== null) return found
  }
  return undefined
}

function getPayloadData(raw: unknown) {
  if (!raw || typeof raw !== 'object') return raw
  const data = (raw as Record<string, unknown>).data
  return data ?? raw
}

function pickBasicData(raw: unknown, zipCode: string): unknown {
  const data = getPayloadData(raw)
  if (!data || typeof data !== 'object') return data
  const basic = (data as Record<string, unknown>).basicdata ?? data
  if (Array.isArray(basic)) {
    const zipRow = basic.find((row) => String((row as Record<string, unknown>)?.zip_code || '').trim() === zipCode)
    const msaRow = basic.find((row) => String((row as Record<string, unknown>)?.zip_code || '').toLowerCase().includes('msa'))
    return zipRow ?? msaRow ?? basic[0]
  }
  return basic
}

function rentForBedroom(raw: unknown, bedroom: 0 | 1 | 2 | 3 | 4, zipCode: string): number | null {
  const basic = pickBasicData(raw, zipCode)
  const keysByBedroom: Record<0 | 1 | 2 | 3 | 4, string[]> = {
    0: ['Efficiency', 'efficiency', 'rent_0br', 'fmr_0', 'fmr0', 'zero_bedroom', '0_br', '0br', 'br0'],
    1: ['One-Bedroom', 'One Bedroom', 'one_bedroom', 'OneBedroom', 'rent_1br', 'fmr_1', 'fmr1', '1_br', '1br', 'br1'],
    2: ['Two-Bedroom', 'Two Bedroom', 'two_bedroom', 'TwoBedroom', 'rent_2br', 'fmr_2', 'fmr2', '2_br', '2br', 'br2'],
    3: ['Three-Bedroom', 'Three Bedroom', 'three_bedroom', 'ThreeBedroom', 'rent_3br', 'fmr_3', 'fmr3', '3_br', '3br', 'br3'],
    4: ['Four-Bedroom', 'Four Bedroom', 'four_bedroom', 'FourBedroom', 'rent_4br', 'fmr_4', 'fmr4', '4_br', '4br', 'br4'],
  }
  return asNumber(findFirst(basic, keysByBedroom[bedroom]) ?? findFirst(raw, keysByBedroom[bedroom]))
}

function bedroomKey(bedrooms?: number | null): 0 | 1 | 2 | 3 | 4 {
  const rounded = Math.round(Number(bedrooms || 0))
  if (rounded <= 0) return 0
  if (rounded >= 4) return 4
  return rounded as 1 | 2 | 3
}

function normalizeRents(raw: unknown, zipCode: string) {
  return {
    0: rentForBedroom(raw, 0, zipCode),
    1: rentForBedroom(raw, 1, zipCode),
    2: rentForBedroom(raw, 2, zipCode),
    3: rentForBedroom(raw, 3, zipCode),
    4: rentForBedroom(raw, 4, zipCode),
  }
}

function hasAnyRent(rents: ReturnType<typeof normalizeRents>) {
  return Object.values(rents).some((value) => typeof value === 'number' && value > 0)
}

function extractHudYear(raw: unknown, fallback: CandidateYear) {
  const year = asNumber(findFirst(raw, ['year']))
  if (year && year >= HUDUSER_MIN_LOOKBACK_YEAR) return Math.round(year)
  return fallback === 'latest' ? new Date().getFullYear() : fallback
}

function ratio(row: Record<string, unknown>) {
  return asNumber(row.res_ratio) ?? asNumber(row.tot_ratio) ?? asNumber(row.bus_ratio) ?? 0
}

function rowsFromUsps(raw: unknown): Array<Record<string, unknown>> {
  const data = getPayloadData(raw)
  const results = findFirst(data, ['results'])
  return Array.isArray(results) ? results.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object')) : []
}

async function resolveMetroCodeFromCbsa(cbsaNumeric: string): Promise<string | null> {
  try {
    const raw = await fetchJson(buildMetroListUrl())
    const data = getPayloadData(raw)
    const rows = Array.isArray(data) ? data : Array.isArray((data as Record<string, unknown>)?.data) ? (data as Record<string, unknown>).data as unknown[] : []
    const metro = rows.find((row) => {
      const code = String((row as Record<string, unknown>)?.cbsa_code || '')
      return code.includes(`M${cbsaNumeric}`) || code.includes(`N${cbsaNumeric}`) || code.endsWith(cbsaNumeric) || code.includes(cbsaNumeric)
    }) as Record<string, unknown> | undefined
    return metro?.cbsa_code ? String(metro.cbsa_code) : null
  } catch {
    return null
  }
}

async function resolveEntitiesForZip(zipCode: string): Promise<HudEntityCandidate[]> {
  const candidates: HudEntityCandidate[] = []

  const customTemplate = process.env.HUDUSER_FMR_LOOKUP_URL_TEMPLATE
  if (customTemplate) candidates.push({ entityId: zipCode, source: 'custom_template', label: 'Custom template direct ZIP' })

  try {
    const raw = await fetchJson(buildUspsUrl(3, zipCode)) // zip-cbsa
    const rows = rowsFromUsps(raw).sort((a, b) => ratio(b) - ratio(a))
    const cbsa = rows[0]?.geoid ? String(rows[0].geoid) : null
    if (cbsa) {
      const metroCode = await resolveMetroCodeFromCbsa(cbsa)
      if (metroCode) candidates.push({ entityId: metroCode, source: 'zip_cbsa_metro', label: `CBSA ${cbsa}`, ratio: ratio(rows[0]) })
    }
  } catch {}

  try {
    const raw = await fetchJson(buildUspsUrl(2, zipCode)) // zip-county
    const rows = rowsFromUsps(raw).sort((a, b) => ratio(b) - ratio(a))
    const county = rows[0]?.geoid ? String(rows[0].geoid).padStart(5, '0') : null
    if (county) candidates.push({ entityId: `${county}99999`, source: 'zip_county', label: `County ${county}`, ratio: ratio(rows[0]) })
  } catch {}

  // Last-resort direct ZIP candidate for custom deployments/API variants. Official FMR data normally expects entity id, not ZIP.
  candidates.push({ entityId: zipCode, source: 'direct_zip', label: 'Direct ZIP fallback' })

  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = `${candidate.source}:${candidate.entityId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function formatHudApiError(message: string) {
  if (message.startsWith('403')) {
    return 'HUD USER returned 403. This usually means the token is not registered for the required dataset API. Confirm the token has FAIR MARKET RENT access, and USPS ZIP CODE CROSSWALK access if using ZIP lookup.'
  }
  if (message.startsWith('401')) return 'HUD USER authentication failed. Check HUDUSER_API_TOKEN.'
  if (message.startsWith('406')) return 'HUD USER rejected the Accept header. The request must accept application/json.'
  return message
}

export async function lookupHudFmrByZip(params: LookupParams): Promise<HudFmrResult> {
  const zipCode = params.zipCode.trim()
  if (!/^\d{5}$/.test(zipCode)) throw new Error('Enter a valid 5-digit ZIP code before running HUD lookup.')
  if (!headers().Authorization) throw new Error('HUDUSER_API_TOKEN is missing. Add it to .env.local and restart the dev server.')

  const candidateYears = getHudCandidateYears(params.hudYear)
  const attemptedYears: Array<number | 'latest'> = []
  const entities = await resolveEntitiesForZip(zipCode)
  let lastError: string | null = null

  for (const entity of entities) {
    for (const hudYear of candidateYears) {
      attemptedYears.push(hudYear)
      const customUrl = entity.source === 'custom_template' ? buildCustomTemplateUrl(zipCode, hudYear) : null
      const sourceUrl = customUrl || buildFmrDataUrl(entity.entityId, hudYear)

      try {
        const raw = await fetchJson(sourceUrl)
        const rents = normalizeRents(raw, zipCode)
        if (!hasAnyRent(rents)) {
          lastError = `HUD response for ${hudYear} using ${entity.source} did not include usable FMR rent fields.`
          continue
        }

        const selectedBedroom = bedroomKey(params.bedrooms)
        const selectedBedroomRent = rents[selectedBedroom]
        const data = getPayloadData(raw)
        const hudYearNumber = extractHudYear(raw, hudYear)

        return {
          zipCode,
          hudYear: hudYearNumber,
          hudYearMode: typeof params.hudYear === 'number' ? 'manual' : 'auto',
          attemptedYears,
          state: (findFirst(raw, ['state', 'State', 'state_code', 'statecode']) as string | undefined) || null,
          county: (findFirst(data, ['county_name', 'county', 'County']) as string | undefined) || null,
          metroArea: (findFirst(data, ['metro_name', 'area_name', 'metro_area', 'metroArea', 'metro']) as string | undefined) || null,
          entityId: entity.entityId,
          entitySource: entity.source,
          rents,
          selectedBedroomRent,
          sourceUrl,
          raw: {
            ...(raw as Record<string, unknown>),
            dealflowiq_resolution: { entity, zipCode, requestedYear: hudYear },
          },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : `HUD USER lookup failed for ${String(hudYear)}.`
        lastError = formatHudApiError(message)
        if (message.startsWith('401') || message.startsWith('403')) {
          throw new Error(`${lastError} Tried entity/source: ${entity.entityId} (${entity.source}).`)
        }
      }
    }
  }

  throw new Error(
    `${lastError || 'HUD USER lookup failed.'} Tried HUD/FMR years: ${attemptedYears.join(', ')}. Tried entities: ${entities.map((entity) => `${entity.entityId} (${entity.source})`).join(', ')}.`,
  )
}
