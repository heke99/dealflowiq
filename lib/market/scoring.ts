import { calculateDealUnderwriting } from '@/lib/calculations/underwriting'

export type MarketListingLike = Record<string, unknown>

function n(value: unknown, fallback = 0) {
  const parsed = Number(value ?? fallback)
  return Number.isFinite(parsed) ? parsed : fallback
}

function positive(value: unknown, fallback = 0) {
  return Math.max(0, n(value, fallback))
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value))
}

export function normalizePropertyType(value: unknown) {
  const raw = String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ')
  if (!raw) return null
  if (raw.includes('duplex')) return 'Duplex'
  if (raw.includes('triplex')) return 'Triplex'
  if (raw.includes('four') || raw.includes('4 plex') || raw.includes('quad')) return 'Fourplex'
  if (raw.includes('multi')) return 'Multifamily'
  if (raw.includes('mixed')) return 'Mixed Use'
  if (raw.includes('retail')) return 'Retail'
  if (raw.includes('office')) return 'Office'
  if (raw.includes('industrial')) return 'Industrial'
  if (raw.includes('land')) return 'Land'
  if (raw.includes('condo')) return 'Condo'
  if (raw.includes('town')) return 'Townhouse'
  if (raw.includes('single')) return 'Single Family'
  return raw.split(' ').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

function labelStrategy(params: { hudGap: number; marketGap: number; capRate: number | null; dscr: number | null; units: number; arv: number; listPrice: number; flipProfit: number | null; wholesaleSpread: number | null }) {
  if (params.hudGap >= 300 && (params.dscr ?? 0) >= 1.15) return 'Section 8 Rental'
  if (params.flipProfit !== null && params.flipProfit > 25000 && params.arv > params.listPrice * 1.15) return 'Fix & Flip'
  if (params.wholesaleSpread !== null && params.wholesaleSpread > 10000) return 'Wholesale'
  if (params.arv > 0 && params.listPrice > 0 && params.arv >= params.listPrice * 1.25) return 'BRRRR / Value-add'
  if (params.units >= 2 && params.capRate !== null && params.capRate >= 0.075) return 'Small Multifamily'
  if (params.marketGap >= 300) return 'Rent Upside Rental'
  if ((params.dscr ?? 0) >= 1.25) return 'Buy & Hold'
  return 'Needs Review'
}

function listingToDeal(listing: MarketListingLike) {
  const price = positive(listing.list_price ?? listing.asking_price ?? listing.purchase_price)
  return {
    purchase_price: price,
    asking_price: price,
    arv: positive(listing.arv),
    rehab_estimate: positive(listing.rehab_estimate),
    current_rent: positive(listing.current_rent ?? listing.estimated_rent),
    market_rent: positive(listing.market_rent ?? listing.estimated_market_rent ?? listing.recommended_market_rent),
    section8_rent: positive(listing.hud_rent ?? listing.section8_rent),
    taxes_annual: positive(listing.taxes_annual),
    insurance_annual: positive(listing.insurance_annual),
    hoa_monthly: positive(listing.hoa_monthly),
    utilities_monthly: positive(listing.utilities_monthly),
    capex_monthly: positive(listing.capex_monthly),
    vacancy_percent: positive(listing.vacancy_percent, 5),
    management_percent: positive(listing.management_percent, 8),
    down_payment_percent: positive(listing.down_payment_percent, 20),
    interest_rate_percent: positive(listing.interest_rate_percent, 7),
    loan_term_months: positive(listing.loan_term_months, 360),
    dscr_min_threshold: positive(listing.dscr_min_threshold, 1.2),
    mao_percentage: positive(listing.mao_percentage, 70),
    desired_wholesale_fee: positive(listing.desired_wholesale_fee, 10000),
    selling_costs_percent: positive(listing.selling_costs_percent, 8),
    holding_costs_monthly: positive(listing.holding_costs_monthly),
    refinance_ltv_percent: positive(listing.refinance_ltv_percent, 75),
  }
}

export function scoreMarketListing(listing: MarketListingLike, options?: { dscrThreshold?: number; interestRatePercent?: number; downPaymentPercent?: number; loanTermMonths?: number }) {
  const deal = {
    ...listingToDeal(listing),
    ...(options?.dscrThreshold ? { dscr_min_threshold: options.dscrThreshold } : {}),
    ...(options?.interestRatePercent ? { interest_rate_percent: options.interestRatePercent } : {}),
    ...(options?.downPaymentPercent ? { down_payment_percent: options.downPaymentPercent } : {}),
    ...(options?.loanTermMonths ? { loan_term_months: options.loanTermMonths } : {}),
  }
  const units = Math.max(1, Math.round(positive(listing.units ?? listing.number_of_units, 1) || 1))
  const summary = calculateDealUnderwriting(deal, { number_of_units: units })
  const primary = summary.primaryScenario
  const listPrice = summary.purchasePrice
  const currentRent = positive(listing.current_rent ?? listing.estimated_rent)
  const marketRent = positive(listing.market_rent ?? listing.estimated_market_rent ?? listing.recommended_market_rent)
  const hudRent = positive(listing.hud_rent ?? listing.section8_rent)
  const marketGap = marketRent && currentRent ? marketRent - currentRent : marketRent && primary.breakEvenRent ? marketRent - primary.breakEvenRent : 0
  const hudGap = hudRent && currentRent ? hudRent - currentRent : hudRent && primary.breakEvenRent ? hudRent - primary.breakEvenRent : 0

  const cashflowScore = clamp((primary.monthlyCashflow + 500) / 15)
  const dscrScore = primary.dscr === null ? 20 : clamp((primary.dscr - 0.85) * 90)
  const capRateScore = primary.capRate === null ? 20 : clamp(primary.capRate * 900)
  const hudScore = clamp((hudGap + 250) / 10)
  const marketScore = clamp((marketGap + 250) / 10)
  const dataFields = [listPrice, primary.monthlyRent, units, Number(Boolean(listing.zip_code)), Number(Boolean(listing.address || listing.city)), Number(Boolean(listing.primary_image_url || (Array.isArray(listing.image_urls) && listing.image_urls.length)))]
  const dataConfidenceScore = clamp(dataFields.filter(Boolean).length / dataFields.length * 100)
  const rentConfidenceScore = clamp(
    (marketRent || hudRent || currentRent ? 35 : 0) +
    (Boolean(listing.zip_code) ? 20 : 0) +
    (Boolean(listing.bedrooms ?? listing.beds) ? 15 : 0) +
    (Boolean(listing.sqft) ? 10 : 0) +
    (Boolean(listing.property_type) ? 10 : 0) +
    (Boolean(listing.address || listing.city) ? 10 : 0),
  )
  const sourceConfidenceScore = clamp(
    (Boolean(listing.source_url) ? 25 : 0) +
    (Boolean(listing.external_listing_id) ? 20 : 0) +
    (Boolean(listing.address || listing.city) ? 20 : 0) +
    (Boolean(listing.list_price ?? listing.asking_price) ? 15 : 0) +
    (Boolean(listing.primary_image_url || (Array.isArray(listing.image_urls) && listing.image_urls.length)) ? 10 : 0) +
    (Boolean(listing.raw_payload) ? 10 : 0),
  )
  const riskPenalty = clamp(
    (!listPrice ? 15 : 0) +
    (!primary.monthlyRent ? 20 : 0) +
    (!listing.zip_code ? 10 : 0) +
    (!listing.primary_image_url && !(Array.isArray(listing.image_urls) && listing.image_urls.length) ? 5 : 0) +
    (primary.dscr !== null && primary.dscr < summary.assumptions.dscr.minimumThreshold ? 12 : 0) +
    (primary.monthlyCashflow < 0 ? 10 : 0),
    0,
    65,
  )
  const dealScore = clamp(cashflowScore * 0.2 + dscrScore * 0.2 + capRateScore * 0.16 + hudScore * 0.14 + marketScore * 0.14 + dataConfidenceScore * 0.16 - riskPenalty * 0.45)

  const reasons: string[] = []
  const risks: string[] = []
  const missingFields: string[] = []

  if (hudGap > 0) reasons.push(`HUD rent upside is about $${Math.round(hudGap).toLocaleString()}/mo.`)
  if (marketGap > 0) reasons.push(`Market rent upside is about $${Math.round(marketGap).toLocaleString()}/mo.`)
  if (primary.dscr !== null && primary.dscr >= summary.assumptions.dscr.minimumThreshold) reasons.push(`DSCR passes threshold at ${primary.dscr.toFixed(2)}.`)
  if (primary.capRate !== null && primary.capRate >= 0.07) reasons.push(`Cap rate is estimated at ${(primary.capRate * 100).toFixed(1)}%.`)
  if (primary.monthlyCashflow > 0) reasons.push(`Estimated cashflow is about $${Math.round(primary.monthlyCashflow).toLocaleString()}/mo.`)
  if (summary.flipProfit !== null && summary.flipProfit > 0) reasons.push(`Flip profit preview is about $${Math.round(summary.flipProfit).toLocaleString()}.`)
  if (summary.wholesaleSpread !== null && summary.wholesaleSpread > 0) reasons.push(`Wholesale spread preview is about $${Math.round(summary.wholesaleSpread).toLocaleString()}.`)

  if (!listPrice) missingFields.push('List or purchase price')
  if (!primary.monthlyRent) missingFields.push('Current, market or HUD rent')
  if (!listing.zip_code) missingFields.push('ZIP code')
  if (!listing.address && !listing.city) missingFields.push('Location')
  if (!listing.primary_image_url && !(Array.isArray(listing.image_urls) && listing.image_urls.length)) missingFields.push('Property image')
  if (!positive(listing.taxes_annual)) risks.push('Taxes are missing or unverified.')
  if (!positive(listing.insurance_annual)) risks.push('Insurance is missing or unverified.')
  if (primary.monthlyCashflow < 0) risks.push('Estimated monthly cashflow is negative.')
  if (primary.dscr !== null && primary.dscr < summary.assumptions.dscr.minimumThreshold) risks.push(`DSCR is below ${summary.assumptions.dscr.minimumThreshold.toFixed(2)}.`)
  if (!reasons.length) reasons.push('Needs more data before DealFlowIQ can rank it strongly.')

  const riskLevel = riskPenalty >= 30 || dealScore < 45 ? 'high' : riskPenalty >= 15 || dealScore < 70 ? 'medium' : 'low'
  const dataConfidence = dataConfidenceScore >= 80 ? 'high' : dataConfidenceScore >= 55 ? 'medium' : 'low'

  return {
    dealScore: Math.round(dealScore),
    riskScore: Math.round(riskPenalty),
    riskLevel,
    dataConfidence,
    dataConfidenceScore: Math.round(dataConfidenceScore),
    rentConfidenceScore: Math.round(rentConfidenceScore),
    sourceConfidenceScore: Math.round(sourceConfidenceScore),
    strategyFit: labelStrategy({
      hudGap,
      marketGap,
      capRate: primary.capRate,
      dscr: primary.dscr,
      units,
      arv: summary.arv,
      listPrice,
      flipProfit: summary.flipProfit,
      wholesaleSpread: summary.wholesaleSpread,
    }),
    estimatedNoi: Math.round(primary.noi),
    estimatedCashflow: Math.round(primary.annualCashflow),
    estimatedMonthlyCashflow: Math.round(primary.monthlyCashflow),
    estimatedDscr: primary.dscr,
    estimatedCapRate: primary.capRate,
    hudRent,
    marketRent,
    selectedRent: primary.monthlyRent,
    rentGap: Math.round(marketGap),
    hudRentGap: Math.round(hudGap),
    breakEvenRent: primary.breakEvenRent ? Math.round(primary.breakEvenRent) : null,
    reasons,
    risks,
    missingFields,
  }
}
