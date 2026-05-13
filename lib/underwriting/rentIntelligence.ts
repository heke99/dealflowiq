export type MarketRentComp = {
  monthly_rent: number | string | null
  bedrooms?: number | string | null
  square_feet?: number | string | null
  confidence_score?: number | string | null
}

export type RentCompSummary = {
  count: number
  lowRent: number | null
  medianRent: number | null
  highRent: number | null
  averageRent: number | null
  recommendedRent: number | null
  averageRentPerSqft: number | null
  confidenceScore: number
}

function n(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function median(values: number[]) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function summarizeMarketRentComps(comps: MarketRentComp[]): RentCompSummary {
  const rents = comps.map((comp) => n(comp.monthly_rent)).filter((rent) => rent > 0)
  const sqftPairs = comps
    .map((comp) => ({ rent: n(comp.monthly_rent), sqft: n(comp.square_feet) }))
    .filter((comp) => comp.rent > 0 && comp.sqft > 0)

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

  return {
    count,
    lowRent: count ? Math.min(...rents) : null,
    medianRent,
    highRent: count ? Math.max(...rents) : null,
    averageRent,
    recommendedRent: medianRent ?? averageRent,
    averageRentPerSqft,
    confidenceScore,
  }
}
