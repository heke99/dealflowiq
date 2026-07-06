import type { Row } from '@/lib/types/rows'
import { capRateNumber, clampScore, moneyNumber, textList, withinRange } from '@/lib/matching/utils'

export type BuyerListingMatchResult = {
  matchScore: number
  reasons: string[]
  risks: string[]
}

/** Matches persist into buyer_deal_matches at or above this score. */
export const BUYER_MATCH_PERSIST_SCORE = 55

/** Matches at or above this score are flagged for review and notify the workspace. */
export const BUYER_MATCH_REVIEW_SCORE = 80

function strategyMatches(buyerStrategies: string[], strategyFit: unknown) {
  if (!buyerStrategies.length) return true
  const fit = String(strategyFit || '').toLowerCase()
  return buyerStrategies.some((strategy) => {
    const s = strategy.toLowerCase()
    if (s.includes('section') && fit.includes('section')) return true
    if (s.includes('brrrr') && fit.includes('brrrr')) return true
    if (s.includes('flip') && fit.includes('flip')) return true
    if (s.includes('wholesale') && fit.includes('wholesale')) return true
    if ((s.includes('hold') || s.includes('rental')) && (fit.includes('hold') || fit.includes('rental'))) return true
    return fit.includes(s)
  })
}

/**
 * Pure buyer-to-listing fit score (0-100) with human-readable reasons/risks.
 * This is the buyer CRM matching engine; buy-box criteria matching lives in
 * lib/market/importRunner.ts and intentionally stays separate.
 */
export function scoreBuyerListingMatch(buyer: Row, listing: Row, score: Row | null): BuyerListingMatchResult {
  let points = 20
  const reasons: string[] = []
  const risks: string[] = []

  const price = moneyNumber(listing.list_price || listing.asking_price)
  const units = Number(listing.units || 1)
  const bedrooms = Number(listing.bedrooms || 0)
  const bathrooms = Number(listing.bathrooms || 0)
  const sqft = Number(listing.sqft || 0)
  const dealScore = Number(score?.deal_score || 0)
  const cashflow = moneyNumber(score?.estimated_monthly_cashflow)
  const dscr = Number(score?.estimated_dscr || 0)
  const capRate = Number(score?.estimated_cap_rate || 0)
  const arvSpread = moneyNumber(listing.arv) && price ? moneyNumber(listing.arv) - price - moneyNumber(listing.rehab_estimate) : 0

  const preferredStates = textList(buyer.preferred_states)
  const preferredCities = textList(buyer.preferred_cities)
  const preferredZips = textList(buyer.preferred_zip_codes)
  const propertyTypes = textList(buyer.property_types)
  const strategies = textList(buyer.strategies)

  if (preferredStates.length || preferredCities.length || preferredZips.length) {
    const stateHit = preferredStates.includes(String(listing.state || '').toLowerCase())
    const cityHit = preferredCities.includes(String(listing.city || '').toLowerCase())
    const zipHit = preferredZips.includes(String(listing.zip_code || '').toLowerCase())
    if (stateHit || cityHit || zipHit) {
      points += zipHit ? 18 : cityHit ? 15 : 10
      reasons.push('Location fits buyer criteria.')
    } else {
      points -= 20
      risks.push('Location is outside buyer criteria.')
    }
  } else {
    points += 6
    reasons.push('Buyer has broad geography.')
  }

  if (propertyTypes.length) {
    const listingType = String(listing.property_type || '').toLowerCase()
    if (propertyTypes.some((type) => listingType.includes(type))) {
      points += 12
      reasons.push('Property type fits buyer demand.')
    } else {
      points -= 14
      risks.push('Property type does not match buyer criteria.')
    }
  } else {
    points += 5
  }

  if (buyer.min_budget && price && price < Number(buyer.min_budget)) {
    points -= 8
    risks.push('Price is below buyer minimum budget.')
  }
  if (buyer.max_budget && price && price > Number(buyer.max_budget)) {
    points -= 22
    risks.push('Price is above buyer max budget.')
  }
  if (price && withinRange(price, moneyNumber(buyer.min_budget) || null, moneyNumber(buyer.max_budget) || null)) {
    points += 15
    reasons.push('Price fits buyer budget.')
  }

  if (buyer.min_units && units < Number(buyer.min_units)) {
    points -= 10
    risks.push('Too few units for this buyer.')
  } else if (buyer.min_units) {
    points += 6
  }
  if (buyer.max_units && units > Number(buyer.max_units)) {
    points -= 10
    risks.push('Too many units for this buyer.')
  } else if (buyer.max_units) {
    points += 6
  }
  if (buyer.min_bedrooms && bedrooms && bedrooms >= Number(buyer.min_bedrooms)) points += 4
  if (buyer.min_bathrooms && bathrooms && bathrooms >= Number(buyer.min_bathrooms)) points += 4
  if (buyer.min_sqft && sqft && sqft >= Number(buyer.min_sqft)) points += 4

  if (strategyMatches(strategies, score?.strategy_fit)) {
    points += strategies.length ? 10 : 4
    reasons.push('Strategy fit aligns with buyer preference.')
  } else if (strategies.length) {
    points -= 10
    risks.push('Strategy fit does not match buyer preference.')
  }

  if (buyer.min_cashflow) {
    if (cashflow >= Number(buyer.min_cashflow)) {
      points += 10
      reasons.push('Projected cashflow meets buyer target.')
    } else {
      points -= 10
      risks.push('Projected cashflow is below buyer target.')
    }
  } else if (cashflow > 0) points += 6

  if (buyer.min_dscr) {
    if (dscr >= Number(buyer.min_dscr)) {
      points += 8
      reasons.push('DSCR meets buyer target.')
    } else if (dscr) {
      points -= 8
      risks.push('DSCR is below buyer target.')
    }
  } else if (dscr >= 1.2) points += 6

  if (buyer.min_cap_rate) {
    if (capRate >= capRateNumber(buyer.min_cap_rate)) {
      points += 8
      reasons.push('Cap rate meets buyer target.')
    } else if (capRate) {
      points -= 8
      risks.push('Cap rate is below buyer target.')
    }
  } else if (capRate >= 0.07) points += 6

  if (buyer.min_arv_spread) {
    if (arvSpread >= Number(buyer.min_arv_spread)) {
      points += 8
      reasons.push('ARV spread meets buyer target.')
    } else if (arvSpread) {
      points -= 8
      risks.push('ARV spread is below buyer target.')
    }
  }

  if (dealScore >= 80) {
    points += 10
    reasons.push('DealFlowIQ score is Opportunity-level.')
  } else if (dealScore > 0 && dealScore < 65) {
    points -= 8
    risks.push('DealFlowIQ score is below strong-opportunity range.')
  }

  const matchScore = clampScore(points)
  if (!reasons.length) reasons.push('Buyer has broad criteria and this listing has enough data to review.')
  return { matchScore, reasons: reasons.slice(0, 8), risks: risks.slice(0, 8) }
}
