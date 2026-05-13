export type HudFmrResult = {
  zipCode: string
  hudYear: number
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
  hudYear?: number | null
}

function currentHudYear() {
  return new Date().getFullYear()
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
  const result: Record<string, string> = {}
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

export async function lookupHudFmrByZip(params: LookupParams): Promise<HudFmrResult> {
  const zipCode = params.zipCode.trim()
  if (!/^\d{5}$/.test(zipCode)) throw new Error('Enter a valid 5-digit ZIP code before running HUD lookup.')

  const hudYear = params.hudYear || currentHudYear()
  const sourceUrl = buildUrl(zipCode, hudYear)
  const response = await fetch(sourceUrl, { headers: headers(), cache: 'no-store' })

  if (!response.ok) {
    throw new Error(`HUD USER lookup failed (${response.status}). Check HUDUSER_API_TOKEN or HUDUSER_FMR_LOOKUP_URL_TEMPLATE.`)
  }

  const raw = await response.json()
  const rents = {
    0: rentForBedroom(raw, 0),
    1: rentForBedroom(raw, 1),
    2: rentForBedroom(raw, 2),
    3: rentForBedroom(raw, 3),
    4: rentForBedroom(raw, 4),
  }

  const selectedBedroom = bedroomKey(params.bedrooms)
  const selectedBedroomRent = rents[selectedBedroom]
  if (!selectedBedroomRent && !Object.values(rents).some(Boolean)) {
    throw new Error('HUD response was received but no FMR rent fields could be normalized. Adjust the endpoint/template mapping or enter HUD rent manually.')
  }

  return {
    zipCode,
    hudYear,
    state: (findFirst(raw, ['state', 'State']) as string | undefined) || null,
    county: (findFirst(raw, ['county', 'County', 'county_name']) as string | undefined) || null,
    metroArea: (findFirst(raw, ['metro_area', 'metroArea', 'area_name', 'metro']) as string | undefined) || null,
    rents,
    selectedBedroomRent,
    sourceUrl,
    raw,
  }
}
