import { calculateMonthlyPayment } from '@/lib/calculations/underwriting'

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

function labelStrategy(params: { hudGap: number; marketGap: number; capRate: number | null; dscr: number | null; units: number; arv: number; listPrice: number }) {
  if (params.hudGap >= 300 && (params.dscr ?? 0) >= 1.15) return 'Section 8 Rental'
  if (params.arv > 0 && params.listPrice > 0 && params.arv >= params.listPrice * 1.25) return 'BRRRR / Value-add'
  if (params.units >= 2 && params.capRate !== null && params.capRate >= 0.075) return 'Small Multifamily'
  if (params.marketGap >= 300) return 'Rent Upside Rental'
  if ((params.dscr ?? 0) >= 1.25) return 'Buy & Hold'
  return 'Needs Review'
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

export function scoreMarketListing(listing: MarketListingLike, options?: { dscrThreshold?: number; interestRatePercent?: number; downPaymentPercent?: number; loanTermMonths?: number }) {
  const listPrice = positive(listing.list_price ?? listing.asking_price ?? listing.purchase_price)
  const units = Math.max(1, Math.round(positive(listing.units ?? listing.number_of_units, 1) || 1))
  const currentRent = positive(listing.current_rent ?? listing.estimated_rent)
  const marketRent = positive(listing.market_rent ?? listing.estimated_market_rent ?? listing.recommended_market_rent)
  const hudRent = positive(listing.hud_rent ?? listing.section8_rent)
  const arv = positive(listing.arv)
  const taxesAnnual = positive(listing.taxes_annual)
  const insuranceAnnual = positive(listing.insurance_annual)
  const hoaMonthly = positive(listing.hoa_monthly)
  const utilitiesMonthly = positive(listing.utilities_monthly)
  const capexMonthly = positive(listing.capex_monthly)
  const vacancyPercent = positive(listing.vacancy_percent, 5) / 100
  const managementPercent = positive(listing.management_percent, 8) / 100
  const downPaymentPercent = positive(options?.downPaymentPercent, 20) / 100
  const loanAmount = listPrice > 0 ? Math.max(0, listPrice * (1 - downPaymentPercent)) : 0
  const monthlyDebtService = calculateMonthlyPayment({
    principal: loanAmount,
    annualInterestRatePercent: positive(options?.interestRatePercent, 7),
    monthlyPayments: Math.max(1, Math.round(positive(options?.loanTermMonths, 360) || 360)),
  })
  const annualDebtService = monthlyDebtService * 12
  const selectedRent = hudRent || marketRent || currentRent
  const annualGrossRent = selectedRent * 12
  const annualFixedExpenses = taxesAnnual + insuranceAnnual + (hoaMonthly + utilitiesMonthly + capexMonthly) * 12
  const vacancyLoss = annualGrossRent * vacancyPercent
  const managementFee = annualGrossRent * managementPercent
  const noi = annualGrossRent - vacancyLoss - annualFixedExpenses - managementFee
  const cashflow = noi - annualDebtService
  const dscr = annualDebtService > 0 ? noi / annualDebtService : null
  const capRate = listPrice > 0 ? noi / listPrice : null
  const breakEvenRent = annualDebtService > 0 || annualFixedExpenses > 0
    ? (annualDebtService + annualFixedExpenses) / Math.max(0.1, 1 - vacancyPercent - managementPercent) / 12
    : null
  const marketGap = marketRent && currentRent ? marketRent - currentRent : marketRent && breakEvenRent ? marketRent - breakEvenRent : 0
  const hudGap = hudRent && currentRent ? hudRent - currentRent : hudRent && breakEvenRent ? hudRent - breakEvenRent : 0

  const cashflowScore = clamp((cashflow / 12 + 500) / 15)
  const dscrScore = dscr === null ? 20 : clamp((dscr - 0.85) * 90)
  const capRateScore = capRate === null ? 20 : clamp(capRate * 900)
  const hudScore = clamp((hudGap + 250) / 10)
  const marketScore = clamp((marketGap + 250) / 10)
  const dataFields = [listPrice, selectedRent, units, Number(Boolean(listing.zip_code)), Number(Boolean(listing.address || listing.city))]
  const dataConfidenceScore = clamp(dataFields.filter(Boolean).length / dataFields.length * 100)
  const riskPenalty = clamp(
    (!listPrice ? 15 : 0) +
    (!selectedRent ? 20 : 0) +
    (!listing.zip_code ? 10 : 0) +
    (dscr !== null && dscr < positive(options?.dscrThreshold, 1.2) ? 12 : 0) +
    (cashflow < 0 ? 10 : 0),
    0,
    60,
  )
  const dealScore = clamp(
    cashflowScore * 0.2 + dscrScore * 0.2 + capRateScore * 0.16 + hudScore * 0.14 + marketScore * 0.14 + dataConfidenceScore * 0.16 - riskPenalty * 0.45,
  )

  const reasons: string[] = []
  const risks: string[] = []
  const missingFields: string[] = []

  if (hudGap > 0) reasons.push(`HUD rent upside is about $${Math.round(hudGap).toLocaleString()}/mo.`)
  if (marketGap > 0) reasons.push(`Market rent upside is about $${Math.round(marketGap).toLocaleString()}/mo.`)
  if (dscr !== null && dscr >= positive(options?.dscrThreshold, 1.2)) reasons.push(`DSCR passes threshold at ${dscr.toFixed(2)}.`)
  if (capRate !== null && capRate >= 0.07) reasons.push(`Cap rate is estimated at ${(capRate * 100).toFixed(1)}%.`)
  if (cashflow > 0) reasons.push(`Estimated cashflow is about $${Math.round(cashflow / 12).toLocaleString()}/mo.`)

  if (!listPrice) missingFields.push('List or purchase price')
  if (!selectedRent) missingFields.push('Current, market or HUD rent')
  if (!listing.zip_code) missingFields.push('ZIP code')
  if (!listing.address && !listing.city) missingFields.push('Location')
  if (!taxesAnnual) risks.push('Taxes are missing or unverified.')
  if (!insuranceAnnual) risks.push('Insurance is missing or unverified.')
  if (cashflow < 0) risks.push('Estimated monthly cashflow is negative.')
  if (dscr !== null && dscr < positive(options?.dscrThreshold, 1.2)) risks.push(`DSCR is below ${positive(options?.dscrThreshold, 1.2).toFixed(2)}.`)
  if (!reasons.length) reasons.push('Needs more data before DealFlowIQ can rank it strongly.')

  const riskLevel = riskPenalty >= 30 || dealScore < 45 ? 'high' : riskPenalty >= 15 || dealScore < 70 ? 'medium' : 'low'
  const dataConfidence = dataConfidenceScore >= 80 ? 'high' : dataConfidenceScore >= 55 ? 'medium' : 'low'

  return {
    dealScore: Math.round(dealScore),
    riskScore: Math.round(riskPenalty),
    riskLevel,
    dataConfidence,
    dataConfidenceScore: Math.round(dataConfidenceScore),
    strategyFit: labelStrategy({ hudGap, marketGap, capRate, dscr, units, arv, listPrice }),
    estimatedNoi: Math.round(noi),
    estimatedCashflow: Math.round(cashflow),
    estimatedMonthlyCashflow: Math.round(cashflow / 12),
    estimatedDscr: dscr,
    estimatedCapRate: capRate,
    hudRent,
    marketRent,
    selectedRent,
    rentGap: Math.round(marketGap),
    hudRentGap: Math.round(hudGap),
    breakEvenRent: breakEvenRent ? Math.round(breakEvenRent) : null,
    reasons,
    risks,
    missingFields,
  }
}
