import type { NormalizedMarketListing } from '@/lib/market/sourceConnectors'

export type RentIntelligenceResult = {
  estimatedRent: number | null
  rentLow: number | null
  rentHigh: number | null
  confidenceScore: number
  confidenceBreakdown: string[]
  missingFields: string[]
  source: 'provider_rent' | 'hud_fmr' | 'rule_based_zip' | 'manual_override' | 'insufficient_data'
}

function positive(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function bedroomsKey(value: unknown) {
  const beds = Math.max(0, Math.min(4, Math.round(Number(value || 0))))
  return beds as 0 | 1 | 2 | 3 | 4
}

export function buildRentConfidenceBreakdown(listing: Record<string, any>, hudRent?: number | null): RentIntelligenceResult {
  const confidence: string[] = []
  const missing: string[] = []
  let points = 8

  const providerRent = positive(listing.market_rent || listing.estimated_rent || listing.current_rent)
  const hud = positive(hudRent || listing.hud_rent)
  const sqft = positive(listing.sqft)
  const beds = positive(listing.bedrooms)
  const price = positive(listing.list_price || listing.asking_price)
  const zip = String(listing.zip_code || '').trim()
  const city = String(listing.city || '').trim()
  const propertyType = String(listing.property_type || '').trim()

  if (zip) { points += 12; confidence.push('+ ZIP matched') } else missing.push('ZIP code missing')
  if (city) { points += 6; confidence.push('+ City/state present') } else missing.push('City/state missing')
  if (beds) { points += 12; confidence.push('+ Bedroom count found') } else missing.push('Bedroom count missing')
  if (sqft) { points += 8; confidence.push('+ Square footage found') } else missing.push('Sqft missing')
  if (propertyType) { points += 6; confidence.push('+ Property type detected') } else missing.push('Property type uncertain')
  if (providerRent) { points += 24; confidence.push('+ Provider/current rent found') }
  if (hud) { points += 24; confidence.push('+ HUD/FMR rent found') }
  if (price) { points += 6; confidence.push('+ Price found') } else missing.push('Price missing')

  const selectedRent = providerRent || hud || estimateRuleBasedRent({ beds, sqft, price, zip })
  if (selectedRent) points += 8
  else missing.push('No rent source available')

  const rents = [providerRent, hud].filter(Boolean)
  if (rents.length >= 2) {
    const min = Math.min(...rents)
    const max = Math.max(...rents)
    if (max / min <= 1.6) { points += 8; confidence.push('+ Rent sources are reasonably aligned') }
    else { points -= 18; confidence.push('- Rent sources are far apart') }
  }
  if (!providerRent) confidence.push('- No provider/current rent')
  if (!hud) confidence.push('- HUD/FMR not found yet')

  const low = selectedRent ? Math.round(selectedRent * 0.9) : null
  const high = selectedRent ? Math.round(selectedRent * 1.1) : null
  const source = providerRent ? 'provider_rent' : hud ? 'hud_fmr' : selectedRent ? 'rule_based_zip' : 'insufficient_data'

  return {
    estimatedRent: selectedRent ? Math.round(selectedRent) : null,
    rentLow: low,
    rentHigh: high,
    confidenceScore: clamp(points),
    confidenceBreakdown: confidence,
    missingFields: missing,
    source,
  }
}

function estimateRuleBasedRent(params: { beds: number; sqft: number; price: number; zip?: string | null }) {
  const beds = params.beds || 0
  const sqft = params.sqft || 0
  const price = params.price || 0
  if (!beds && !sqft && !price) return 0
  const bedBase = beds ? 850 + beds * 325 : 0
  const sqftBase = sqft ? sqft * 1.25 : 0
  const priceBase = price ? (price * 0.0075) : 0
  const candidates = [bedBase, sqftBase, priceBase].filter((value) => value >= 500 && value <= 8000)
  if (!candidates.length) return 0
  return candidates.reduce((sum, value) => sum + value, 0) / candidates.length
}

export function buildDataQualityChecklist(listing: Record<string, any>, score?: Record<string, any> | null, hudSnapshot?: Record<string, any> | null) {
  return [
    { label: 'Address found', ok: Boolean(listing.address || listing.city) },
    { label: 'ZIP found', ok: Boolean(listing.zip_code) },
    { label: 'Price found', ok: Boolean(Number(listing.list_price || listing.asking_price || 0)) },
    { label: 'Beds/baths found', ok: Boolean(Number(listing.bedrooms || 0) || Number(listing.bathrooms || 0)) },
    { label: 'Sqft found', ok: Boolean(Number(listing.sqft || 0)) },
    { label: 'HUD rent found', ok: Boolean(hudSnapshot?.selected_fmr || listing.hud_rent) },
    { label: 'Market rent estimated', ok: Boolean(listing.market_rent || listing.estimated_rent || score?.market_rent) },
    { label: 'Buyer match complete', ok: Boolean(Number(listing.buyer_match_count || 0) > 0 || listing.raw_payload?.buyerMatchingRunAt) },
    { label: 'Images imported', ok: Boolean(listing.primary_image_url || (Array.isArray(listing.image_urls) && listing.image_urls.length)) },
    { label: 'Source link saved', ok: Boolean(listing.source_url) },
    { label: 'Provider data expiry tracked', ok: Boolean(listing.source_data_expires_at) },
  ]
}

export function buildWhyThisDeal(params: { listing: Record<string, any>; score?: Record<string, any> | null; missing?: string[] }) {
  const score = params.score || {}
  const dealScore = Number(score.deal_score || 0)
  const rentConfidence = Number(score.rent_confidence_score || 0)
  const cashflow = Number(score.estimated_monthly_cashflow || 0)
  const dscr = Number(score.estimated_dscr || 0)
  const capRate = Number(score.estimated_cap_rate || 0)
  const missing = params.missing || []

  if (dealScore >= 80 && rentConfidence >= 65) {
    const signals = []
    if (cashflow > 0) signals.push('projected cash flow is positive')
    if (dscr >= 1.2) signals.push('DSCR appears bankable')
    if (capRate >= 0.07) signals.push('cap rate is above target')
    if (rentConfidence >= 65) signals.push('rent confidence is acceptable')
    return `This deal is strong because ${signals.length ? signals.join(', ') : 'the score passes the opportunity threshold'}.`
  }
  if (rentConfidence < 65) {
    return `This deal needs review because rent confidence is low${missing.length ? ` and ${missing.slice(0, 2).join(', ').toLowerCase()} needs verification` : ''}.`
  }
  if (cashflow < 0 || (dscr > 0 && dscr < 1.2)) {
    return 'This deal is weak because projected cash flow or DSCR is below lender/investor targets.'
  }
  return 'This deal needs more review before it can be promoted to a qualified opportunity.'
}

export function selectedHudRentFromSnapshot(snapshot: Record<string, any> | null | undefined, bedrooms: unknown) {
  if (!snapshot) return null
  const bed = bedroomsKey(bedrooms)
  return positive(snapshot.selected_fmr || snapshot[`fmr_${bed}br`] || snapshot.fmr_4br || snapshot.fmr_3br || snapshot.fmr_2br || snapshot.fmr_1br || snapshot.fmr_0br) || null
}
