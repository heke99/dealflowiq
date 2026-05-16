import { lookupHudFmrByZip } from '@/lib/integrations/hud/fmrClient'
import { scoreMarketListing } from '@/lib/market/scoring'
import { determineDealReviewStatus } from '@/lib/market/review'
import { recordMarketListingActivity } from '@/lib/market/activity'
import { createInAppNotification } from '@/lib/notifications'

type SupabaseLike = any

type ListingLike = Record<string, any>

function n(value: unknown) {
  const parsed = Number(String(value ?? '').replace(/[$,\s]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value))
}

function bedroomCount(listing: ListingLike) {
  const beds = Math.round(n(listing.bedrooms))
  return Math.max(0, Math.min(4, beds || 2))
}

export function buildDataQualityChecklist(listing: ListingLike, score?: Record<string, any> | null) {
  return [
    { key: 'address', label: 'Address found', ok: Boolean(listing.address || listing.city) },
    { key: 'zip', label: 'ZIP found', ok: Boolean(listing.zip_code) },
    { key: 'price', label: 'Price found', ok: Boolean(n(listing.list_price || listing.asking_price)) },
    { key: 'beds_baths', label: 'Beds/baths found', ok: Boolean(n(listing.bedrooms) || n(listing.bathrooms)) },
    { key: 'sqft', label: 'Sqft found', ok: Boolean(n(listing.sqft)) },
    { key: 'hud', label: 'HUD rent found', ok: Boolean(n(listing.hud_rent)) },
    { key: 'market_rent', label: 'Market rent estimated', ok: Boolean(n(listing.market_rent || listing.estimated_rent)) },
    { key: 'source_link', label: 'Source link saved', ok: Boolean(listing.source_url) },
    { key: 'expiry', label: 'Provider data expiry tracked', ok: Boolean(listing.provider_data_expires_at || listing.source_policy_snapshot) },
    { key: 'score', label: 'Deal score calculated', ok: Boolean(score?.deal_score || score?.dealScore) },
  ]
}

export function buildConfidenceBreakdown(listing: ListingLike, score?: Record<string, any> | null) {
  const positives: string[] = []
  const negatives: string[] = []
  if (listing.zip_code) positives.push('ZIP matched')
  else negatives.push('ZIP missing')
  if (listing.hud_rent) positives.push('HUD/FMR found')
  else negatives.push('HUD/FMR missing')
  if (listing.bedrooms) positives.push('Bedroom count found')
  else negatives.push('Bedroom count missing')
  if (listing.sqft) positives.push('Sqft found')
  else negatives.push('Sqft missing')
  if (listing.market_rent || listing.estimated_rent) positives.push('Market rent estimate available')
  else negatives.push('No market rent estimate')
  if (listing.source_url) positives.push('Source link saved')
  else negatives.push('Source link missing')
  if (score?.estimated_dscr || score?.estimatedDscr) positives.push('DSCR calculated')
  return { positives, negatives }
}

export function estimateMarketRentFromFacts(listing: ListingLike) {
  const explicit = n(listing.market_rent || listing.estimated_rent)
  const hud = n(listing.hud_rent)
  const sqft = n(listing.sqft)
  const beds = bedroomCount(listing)
  let estimate = explicit || hud || 0
  const signals: string[] = []
  const missing: string[] = []

  if (explicit) signals.push('Existing market rent source was present')
  if (!estimate && hud) {
    estimate = hud
    signals.push('HUD/FMR was used as rent baseline')
  }
  if (!estimate && sqft) {
    const perSqft = beds >= 4 ? 1.2 : beds === 3 ? 1.35 : beds === 2 ? 1.45 : 1.55
    estimate = Math.round(sqft * perSqft)
    signals.push('Sqft-based fallback estimate was used')
  }
  if (!estimate) {
    const bedroomBase = [950, 1150, 1400, 1700, 2050][beds] || 1400
    estimate = bedroomBase
    signals.push('Bedroom fallback estimate was used')
  }

  if (!listing.zip_code) missing.push('ZIP code')
  if (!listing.bedrooms) missing.push('Bedrooms')
  if (!listing.sqft) missing.push('Sqft')
  if (!explicit && !hud) missing.push('Verified rent source')

  const confidence = clamp(30 + (listing.zip_code ? 12 : 0) + (listing.bedrooms ? 12 : 0) + (listing.sqft ? 12 : 0) + (explicit ? 22 : 0) + (hud ? 18 : 0) - missing.length * 4)
  const low = Math.round(estimate * 0.9)
  const high = Math.round(estimate * 1.1)
  return { estimate, low, high, confidence, signals, missing }
}

export async function applyMarketRentEstimateToListing(params: { supabase: SupabaseLike; organizationId: string; userId?: string | null; listing: ListingLike; source?: string }) {
  const rent = estimateMarketRentFromFacts(params.listing)
  const inputSnapshot = {
    zipCode: params.listing.zip_code,
    city: params.listing.city,
    state: params.listing.state,
    bedrooms: params.listing.bedrooms,
    bathrooms: params.listing.bathrooms,
    sqft: params.listing.sqft,
    propertyType: params.listing.property_type,
    sourceType: params.listing.source_type,
  }

  await params.supabase.from('listing_rent_estimates').insert({
    organization_id: params.organizationId,
    listing_id: params.listing.id,
    created_by: params.userId || null,
    source: params.source || 'auto_market_rent',
    estimated_rent: rent.estimate,
    rent_low: rent.low,
    rent_high: rent.high,
    confidence_score: rent.confidence,
    confidence_breakdown: { positives: rent.signals, negatives: rent.missing },
    input_snapshot: inputSnapshot,
  })

  const { data: updated } = await params.supabase
    .from('market_listings')
    .update({
      market_rent: rent.estimate,
      estimated_rent: rent.estimate,
      rent_confidence_score: rent.confidence,
      review_reason: rent.confidence < 65 ? 'Market rent was estimated, but confidence is below the Opportunity gate.' : undefined,
    })
    .eq('id', params.listing.id)
    .eq('organization_id', params.organizationId)
    .select('*')
    .single()

  await recordMarketListingActivity(params.supabase, {
    organizationId: params.organizationId,
    listingId: params.listing.id,
    actorId: params.userId || null,
    eventType: 'rent_analysis_completed',
    title: 'Market rent estimated',
    description: `Estimated market rent: $${Math.round(rent.estimate).toLocaleString()}/mo · confidence ${rent.confidence}/100`,
    metadata: { rent },
  })

  if (rent.confidence < 65) {
    await createInAppNotification(params.supabase, {
      organizationId: params.organizationId,
      userId: params.userId || null,
      actorId: params.userId || null,
      type: 'rent_analysis_failed',
      title: 'Market rent needs review',
      message: `${params.listing.title || 'A listing'} has low market rent confidence.`,
      relatedEntityType: 'market_listing',
      relatedEntityId: params.listing.id,
      actionHref: `/market/${params.listing.id}`,
      metadata: { confidence: rent.confidence, missing: rent.missing },
    })
  }

  return { listing: updated || params.listing, rent }
}

export async function applyHudFmrToListing(params: { supabase: SupabaseLike; organizationId: string; userId?: string | null; listing: ListingLike; hudYear?: number | 'auto' }) {
  const zipCode = String(params.listing.zip_code || '').trim()
  if (!zipCode) throw new Error('ZIP code is required before HUD/FMR lookup can run.')
  const bedrooms = bedroomCount(params.listing)
  const hud = await lookupHudFmrByZip({ zipCode, bedrooms, hudYear: params.hudYear || 'auto' })
  const selected = hud.selectedBedroomRent

  await params.supabase.from('listing_hud_rent_snapshots').insert({
    organization_id: params.organizationId,
    listing_id: params.listing.id,
    state: hud.state || params.listing.state || null,
    county: hud.county || params.listing.county || null,
    zip_code: zipCode,
    bedrooms,
    hud_year: hud.hudYear,
    fmr_0br: hud.rents[0],
    fmr_1br: hud.rents[1],
    fmr_2br: hud.rents[2],
    fmr_3br: hud.rents[3],
    fmr_4br: hud.rents[4],
    selected_fmr: selected,
    lookup_status: selected ? 'completed' : 'missing_selected_rent',
    confidence_score: selected ? 80 : 45,
    source_url: hud.sourceUrl,
    raw_payload: hud.raw as any,
  })

  const { data: updated } = selected
    ? await params.supabase
        .from('market_listings')
        .update({ hud_rent: selected, rent_confidence_score: 80 })
        .eq('id', params.listing.id)
        .eq('organization_id', params.organizationId)
        .select('*')
        .single()
    : { data: params.listing }

  await recordMarketListingActivity(params.supabase, {
    organizationId: params.organizationId,
    listingId: params.listing.id,
    actorId: params.userId || null,
    eventType: 'hud_lookup_completed',
    title: selected ? 'HUD/FMR lookup completed' : 'HUD/FMR lookup missing selected rent',
    description: selected ? `HUD/FMR selected rent: $${Math.round(selected).toLocaleString()}/mo for ${bedrooms}BR.` : 'HUD returned data, but no selected bedroom rent was available.',
    metadata: { hudYear: hud.hudYear, selectedBedroomRent: selected, sourceUrl: hud.sourceUrl },
  })

  return { listing: updated || params.listing, hud }
}

export async function rescoreListingAfterIntelligence(params: { supabase: SupabaseLike; organizationId: string; userId?: string | null; listing: ListingLike }) {
  const score = scoreMarketListing(params.listing)
  const calculatedAt = new Date().toISOString()
  const { data: insertedScore } = await params.supabase.from('market_listing_scores').insert({
    listing_id: params.listing.id,
    organization_id: params.organizationId,
    formula_version: 'market-score-v5-rent-sync',
    deal_score: score.dealScore,
    risk_score: score.riskScore,
    risk_level: score.riskLevel,
    data_confidence: score.dataConfidence,
    data_confidence_score: score.dataConfidenceScore,
    rent_confidence_score: score.rentConfidenceScore,
    source_confidence_score: score.sourceConfidenceScore,
    strategy_fit: score.strategyFit,
    estimated_noi: score.estimatedNoi,
    estimated_cashflow: score.estimatedCashflow,
    estimated_monthly_cashflow: score.estimatedMonthlyCashflow,
    estimated_dscr: score.estimatedDscr,
    estimated_cap_rate: score.estimatedCapRate,
    hud_rent: score.hudRent || null,
    market_rent: score.marketRent || null,
    rent_gap: score.rentGap,
    hud_rent_gap: score.hudRentGap,
    break_even_rent: score.breakEvenRent,
    reasons: score.reasons,
    risks: score.risks,
    missing_fields: score.missingFields,
    calculated_at: calculatedAt,
  }).select('id').single()
  const review = determineDealReviewStatus(score as any, params.listing)
  await params.supabase.from('market_listings').update({
    deal_status: review.dealStatus,
    review_reason: review.reviewReason,
    why_this_deal: review.why,
    status: ['archived', 'converted_to_deal'].includes(String(params.listing.status)) ? params.listing.status : review.listingStatus,
    latest_score_id: insertedScore?.id || null,
    latest_deal_score: score.dealScore,
    latest_rent_confidence_score: score.rentConfidenceScore,
    latest_source_confidence_score: score.sourceConfidenceScore,
    latest_data_confidence_score: score.dataConfidenceScore,
    latest_estimated_monthly_cashflow: score.estimatedMonthlyCashflow,
    latest_estimated_dscr: score.estimatedDscr,
    latest_estimated_cap_rate: score.estimatedCapRate,
    latest_break_even_rent: score.breakEvenRent,
    latest_score_calculated_at: calculatedAt,
    data_quality_checklist: buildDataQualityChecklist(params.listing, score as any),
    confidence_breakdown: buildConfidenceBreakdown(params.listing, score as any),
  }).eq('id', params.listing.id).eq('organization_id', params.organizationId)
  return score
}

export async function runListingRentIntelligence(params: { supabase: SupabaseLike; organizationId: string; userId?: string | null; listing: ListingLike; runHud?: boolean }) {
  let current = params.listing
  let hudError: string | null = null
  if (params.runHud !== false && String(params.listing.asset_class || params.listing.property_type || '').toLowerCase() !== 'commercial') {
    try {
      const hud = await applyHudFmrToListing({ ...params, listing: current })
      current = hud.listing
    } catch (error) {
      hudError = error instanceof Error ? error.message : 'HUD lookup failed'
      await createInAppNotification(params.supabase, {
        organizationId: params.organizationId,
        userId: params.userId || null,
        actorId: params.userId || null,
        type: 'hud_lookup_failed',
        title: 'HUD/FMR lookup failed',
        message: hudError,
        relatedEntityType: 'market_listing',
        relatedEntityId: params.listing.id,
        actionHref: `/market/${params.listing.id}`,
        metadata: { zipCode: params.listing.zip_code },
      })
    }
  }
  const rent = await applyMarketRentEstimateToListing({ ...params, listing: current })
  const score = await rescoreListingAfterIntelligence({ ...params, listing: rent.listing })
  return { rent: rent.rent, score, hudError }
}
