export const MIN_REASONABLE_MONTHLY_RENT = 250
export const MAX_REASONABLE_MONTHLY_RENT = 50000

export type MarketRentComp = {
  monthly_rent: number | string | null
  bedrooms?: number | string | null
  square_feet?: number | string | null
  confidence_score?: number | string | null
}

export type RentCompSummary = {
  count: number
  validCount: number
  ignoredCount: number
  lowRent: number | null
  medianRent: number | null
  highRent: number | null
  averageRent: number | null
  recommendedRent: number | null
  averageRentPerSqft: number | null
  confidenceScore: number
  warnings: string[]
}

export function n(value: unknown) {
  if (value === null || value === undefined) return 0
  const cleaned = String(value).replace(/[$\s]/g, '').replace(/,/g, '')
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : 0
}

export function isReasonableMonthlyRent(value: unknown) {
  const rent = n(value)
  return rent >= MIN_REASONABLE_MONTHLY_RENT && rent <= MAX_REASONABLE_MONTHLY_RENT
}

export function normalizeMonthlyRent(value: unknown) {
  const rent = n(value)
  return isReasonableMonthlyRent(rent) ? rent : null
}

function median(values: number[]) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function removeIqrOutliers(values: number[]) {
  if (values.length < 4) return { values, outliers: [] as number[] }
  const sorted = [...values].sort((a, b) => a - b)
  const lower = sorted.slice(0, Math.floor(sorted.length / 2))
  const upper = sorted.slice(Math.ceil(sorted.length / 2))
  const q1 = median(lower) ?? sorted[0]
  const q3 = median(upper) ?? sorted[sorted.length - 1]
  const iqr = q3 - q1
  const low = q1 - iqr * 1.5
  const high = q3 + iqr * 1.5
  return {
    values: sorted.filter((value) => value >= low && value <= high),
    outliers: sorted.filter((value) => value < low || value > high),
  }
}

export function summarizeMarketRentComps(comps: MarketRentComp[]): RentCompSummary {
  const rawRents = comps.map((comp) => n(comp.monthly_rent)).filter((rent) => rent > 0)
  const reasonableRents = rawRents.filter((rent) => isReasonableMonthlyRent(rent))
  const outlierResult = removeIqrOutliers(reasonableRents)
  const rents = outlierResult.values

  const sqftPairs = comps
    .map((comp) => ({ rent: n(comp.monthly_rent), sqft: n(comp.square_feet) }))
    .filter((comp) => isReasonableMonthlyRent(comp.rent) && comp.sqft > 0 && !outlierResult.outliers.includes(comp.rent))

  const count = rents.length
  const averageRent = count ? rents.reduce((sum, rent) => sum + rent, 0) / count : null
  const medianRent = median(rents)
  const averageRentPerSqft = sqftPairs.length
    ? sqftPairs.reduce((sum, comp) => sum + comp.rent / comp.sqft, 0) / sqftPairs.length
    : null

  const explicitConfidence = comps
    .map((comp) => n(comp.confidence_score))
    .filter((score) => score > 0)
  const confidenceScore = Math.min(100, Math.round(
    (count >= 5 ? 55 : count * 10) +
    (sqftPairs.length >= 3 ? 20 : sqftPairs.length * 5) +
    (explicitConfidence.length ? explicitConfidence.reduce((sum, score) => sum + score, 0) / explicitConfidence.length * 0.25 : 0)
  ))

  const ignoredCount = rawRents.length - count
  const warnings: string[] = []
  if (reasonableRents.length !== rawRents.length) warnings.push(`Ignored ${rawRents.length - reasonableRents.length} comp(s) outside the reasonable monthly rent range $${MIN_REASONABLE_MONTHLY_RENT.toLocaleString()}–$${MAX_REASONABLE_MONTHLY_RENT.toLocaleString()}.`)
  if (outlierResult.outliers.length) warnings.push(`Ignored ${outlierResult.outliers.length} statistical outlier comp(s) so the market-rent estimate is not distorted.`)

  return {
    count: rawRents.length,
    validCount: count,
    ignoredCount,
    lowRent: count ? Math.min(...rents) : null,
    medianRent,
    highRent: count ? Math.max(...rents) : null,
    averageRent,
    recommendedRent: medianRent ?? averageRent,
    averageRentPerSqft,
    confidenceScore,
    warnings,
  }
}
