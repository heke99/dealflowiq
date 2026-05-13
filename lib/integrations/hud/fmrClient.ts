export type HudYearMode = 'auto' | 'manual'

export type HudFmrResult = {
  zipCode: string
  hudYear: number
  hudYearMode: HudYearMode
  attemptedYears: number[]
  state?: string | null
  county?: string | null
  metroArea?: string | null
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

export const HUDUSER_MIN_LOOKBACK_YEAR = 2020

export function getHudConfiguredDefaultYear(): number | null {
  const forced = Number(process.env.HUDUSER_FORCE_YEAR || '')
  if (Number.isFinite(forced) && forced >= HUDUSER_MIN_LOOKBACK_YEAR) return Math.round(forced)

  const configured = String(process.env.HUDUSER_DEFAULT_YEAR || 'auto').trim().toLowerCase()
  if (!configured || configured === 'auto' || configured === 'latest') return null

  const parsed = Number(configured)
  return Number.isFinite(parsed) && parsed >= HUDUSER_MIN_LOOKBACK_YEAR ? Math.round(parsed) : null
}

export function getHudCandidateYears(explicitYear?: number | 'auto' | null) {
  if (typeof explicitYear === 'number' && Number.isFinite(explicitYear) && explicitYear >= HUDUSER_MIN_LOOKBACK_YEAR) {
    return [Math.round(explicitYear)]
  }

  const configured = getHudConfiguredDefaultYear()
  if (configured) return [configured]

  // HUD/FMR fiscal-year data can be released ahead of or behind the calendar year.
  // Try next year first, then walk backward until a published year responds.
  const currentYear = new Date().getFullYear()
  const firstCandidate = currentYear + 1
  const years: number[] = []
  for (let year = firstCandidate; year >= HUDUSER_MIN_LOOKBACK_YEAR; year -= 1) years.push(year)
  return years
}

function envTemplate() {
  return process.env.HUDUSER_FMR_LOOKUP_URL_TEMPLATE || ''
}

function buildUrl(zipCode: string, hudYear: number) {
  const template = envTemplate()
  if (template) return template.replaceAll('{zip}', encodeURIComponent(zipCode)).replaceAll('{year}', String(hudYear))

  const base = process.env.HUDUSER_FMR_API_BASE_URL || 'https://www.huduser.gov/hudapi/public/fmr/data'
  const joiner = base.includes('?') ? '&' : '?'
  return `${base.replace(/\/$/, '')}/${encodeURIComponent(zipCode)}${joiner}year=${encodeURIComponent(String(hudYear))}`
}

function headers(): Record<string, string> {
  const token = process.env.HUDUSER_API_TOKEN || process.env.HUD_USER_API_TOKEN
  const result: Record<string, string> = { Accept: 'application/json' }
  if (token) result.Authorization = `Bearer ${token}`
  return result
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

function rentForBedroom(raw: unknown, bedroom: 0 | 1 | 2 | 3 | 4): number | null {
  const keysByBedroom: Record<0 | 1 | 2 | 3 | 4, string[]> = {
    0: ['rent_0br', 'fmr_0', 'fmr0', 'zero_bedroom', 'Efficiency', 'efficiency', '0_br', '0br', 'br0'],
    1: ['rent_1br', 'fmr_1', 'fmr1', 'one_bedroom', 'OneBedroom', '1_br', '1br', 'br1'],
    2: ['rent_2br', 'fmr_2', 'fmr2', 'two_bedroom', 'TwoBedroom', '2_br', '2br', 'br2'],
    3: ['rent_3br', 'fmr_3', 'fmr3', 'three_bedroom', 'ThreeBedroom', '3_br', '3br', 'br3'],
    4: ['rent_4br', 'fmr_4', 'fmr4', 'four_bedroom', 'FourBedroom', '4_br', '4br', 'br4'],
  }
  return asNumber(findFirst(raw, keysByBedroom[bedroom]))
}

function bedroomKey(bedrooms?: number | null): 0 | 1 | 2 | 3 | 4 {
  const rounded = Math.round(Number(bedrooms || 0))
  if (rounded <= 0) return 0
  if (rounded >= 4) return 4
  return rounded as 1 | 2 | 3
}

function normalizeRents(raw: unknown) {
  return {
    0: rentForBedroom(raw, 0),
    1: rentForBedroom(raw, 1),
    2: rentForBedroom(raw, 2),
    3: rentForBedroom(raw, 3),
    4: rentForBedroom(raw, 4),
  }
}

function hasAnyRent(rents: ReturnType<typeof normalizeRents>) {
  return Object.values(rents).some((value) => typeof value === 'number' && value > 0)
}

export async function lookupHudFmrByZip(params: LookupParams): Promise<HudFmrResult> {
  const zipCode = params.zipCode.trim()
  if (!/^\d{5}$/.test(zipCode)) throw new Error('Enter a valid 5-digit ZIP code before running HUD lookup.')

  const candidateYears = getHudCandidateYears(params.hudYear)
  const attemptedYears: number[] = []
  let lastError: string | null = null

  for (const hudYear of candidateYears) {
    attemptedYears.push(hudYear)
    const sourceUrl = buildUrl(zipCode, hudYear)

    try {
      const response = await fetch(sourceUrl, { headers: headers(), cache: 'no-store' })
      if (!response.ok) {
        lastError = `HUD USER lookup failed for ${hudYear} (${response.status}).`
        continue
      }

      const raw = await response.json()
      const rents = normalizeRents(raw)
      if (!hasAnyRent(rents)) {
        lastError = `HUD response for ${hudYear} did not include usable FMR rent fields.`
        continue
      }

      const selectedBedroom = bedroomKey(params.bedrooms)
      const selectedBedroomRent = rents[selectedBedroom]

      return {
        zipCode,
        hudYear,
        hudYearMode: typeof params.hudYear === 'number' ? 'manual' : 'auto',
        attemptedYears,
        state: (findFirst(raw, ['state', 'State']) as string | undefined) || null,
        county: (findFirst(raw, ['county', 'County', 'county_name']) as string | undefined) || null,
        metroArea: (findFirst(raw, ['metro_area', 'metroArea', 'area_name', 'metro']) as string | undefined) || null,
        rents,
        selectedBedroomRent,
        sourceUrl,
        raw,
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : `HUD USER lookup failed for ${hudYear}.`
    }
  }

  throw new Error(
    `${lastError || 'HUD USER lookup failed.'} Tried HUD/FMR years: ${attemptedYears.join(', ')}. Check HUDUSER_API_TOKEN and endpoint settings.`,
  )
}
