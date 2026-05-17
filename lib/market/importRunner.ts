import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { scoreMarketListing, normalizePropertyType } from '@/lib/market/scoring'
import { determineDealReviewStatus } from '@/lib/market/review'
import { recordMarketListingActivity } from '@/lib/market/activity'
import { createInAppNotification } from '@/lib/notifications'
import { classifyOpportunity, OPPORTUNITY_RENT_CONFIDENCE_THRESHOLD, OPPORTUNITY_SCORE_THRESHOLD } from '@/lib/market/opportunityRules'
import { applyAutomatedRentIntelligence } from '@/lib/market/rentAutomation'
import {
  buildNormalizedListingKey,
  detectSourceType,
  fetchAndNormalizeMarketUrl,
  type NormalizedMarketListing,
} from '@/lib/market/sourceConnectors'

type SupabaseAny = ReturnType<typeof createSupabaseAdminClient>

type SourceRow = Record<string, any>

function asArrayOfUrls(settings: Record<string, any>) {
  const values = [settings.source_url, settings.sourceUrl, settings.url]
  const arrays = [settings.source_urls, settings.sourceUrls, settings.urls, settings.search_urls, settings.searchUrls]
  const urls = new Set<string>()

  for (const value of values) {
    if (typeof value === 'string') value.split(/[\n,]+/).forEach((item) => urls.add(item.trim()))
  }
  for (const value of arrays) {
    if (Array.isArray(value)) value.forEach((item) => typeof item === 'string' && urls.add(item.trim()))
    if (typeof value === 'string') value.split(/[\n,]+/).forEach((item) => urls.add(item.trim()))
  }

  return [...urls].filter((item) => item.startsWith('http://') || item.startsWith('https://')).slice(0, 25)
}


async function loadQueuedUrls(supabase: SupabaseAny, source: SourceRow, limit: number) {
  const { data, error } = await supabase
    .from('market_source_queue_items')
    .select('*')
    .eq('source_id', source.id)
    .in('status', ['queued', 'failed'])
    .or('next_attempt_at.is.null,next_attempt_at.lte.' + new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) return []
  return (data || []).filter((item: any) => typeof item.input_url === 'string' && item.input_url.startsWith('http'))
}

async function seedSourceQueueFromSettings(supabase: SupabaseAny, source: SourceRow, urls: string[]) {
  if (!urls.length) return
  const rows = urls.map((inputUrl) => ({
    organization_id: source.organization_id,
    source_id: source.id,
    input_url: inputUrl,
    status: 'queued',
    priority: 50,
    buy_box_id: source.buy_box_id || null,
  }))
  await supabase.from('market_source_queue_items').upsert(rows, { onConflict: 'source_id,input_url' })
}

function retryAt(attempts: number) {
  const date = new Date()
  const delayMinutes = Math.min(60 * 24, Math.max(15, attempts * attempts * 15))
  date.setMinutes(date.getMinutes() + delayMinutes)
  return date.toISOString()
}

function nextRunFor(frequency: string | null | undefined) {
  const now = new Date()
  const value = String(frequency || 'daily')
  if (value === 'hourly') now.setHours(now.getHours() + 1)
  else if (value === 'twice_daily') now.setHours(now.getHours() + 12)
  else if (value === 'weekly') now.setDate(now.getDate() + 7)
  else now.setDate(now.getDate() + 1)
  return now.toISOString()
}

function compactObject(value: Record<string, any>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== '')
  )
}

function listingInsertPayload(params: {
  listing: NormalizedMarketListing | Record<string, any>
  organizationId: string
  userId?: string | null
  sourceId?: string | null
  importJobId?: string | null
  visibility?: string
}) {
  const listing: Record<string, any> = params.listing
  const baseRawPayload = listing.raw_payload && typeof listing.raw_payload === 'object' && !Array.isArray(listing.raw_payload)
    ? listing.raw_payload
    : { source: 'scheduled_market_import', createdAt: new Date().toISOString() }
  const sourceMetadata = compactObject({
    asset_class: listing.asset_class,
    latitude: listing.latitude,
    longitude: listing.longitude,
    listing_status: listing.listing_status,
    days_on_market: listing.days_on_market,
  })

  return {
    organization_id: params.organizationId,
    created_by: params.userId || null,
    source_id: params.sourceId || null,
    import_job_id: params.importJobId || null,
    source_type: listing.source_type || 'manual_url',
    external_listing_id: listing.external_listing_id || null,
    source_url: listing.source_url || null,
    title: listing.title || listing.address || 'Untitled opportunity',
    address: listing.address || null,
    city: listing.city || null,
    state: listing.state || null,
    zip_code: listing.zip_code || null,
    county: listing.county || null,
    property_type: normalizePropertyType(listing.property_type),
    deal_stage: listing.deal_stage || 'imported',
    units: listing.units || 1,
    bedrooms: listing.bedrooms || null,
    bathrooms: listing.bathrooms || null,
    sqft: listing.sqft || null,
    lot_size: listing.lot_size || null,
    year_built: listing.year_built || null,
    list_price: listing.list_price || listing.asking_price || null,
    asking_price: listing.asking_price || listing.list_price || null,
    arv: listing.arv || null,
    rehab_estimate: listing.rehab_estimate || null,
    current_rent: listing.current_rent || null,
    market_rent: listing.market_rent || null,
    hud_rent: listing.hud_rent || null,
    estimated_rent: listing.estimated_rent || null,
    taxes_annual: listing.taxes_annual || null,
    insurance_annual: listing.insurance_annual || null,
    hoa_monthly: listing.hoa_monthly || null,
    utilities_monthly: listing.utilities_monthly || null,
    description: listing.description || null,
    broker_name: listing.broker_name || null,
    broker_phone: listing.broker_phone || null,
    broker_email: listing.broker_email || null,
    primary_image_url: listing.primary_image_url || (Array.isArray(listing.image_urls) ? listing.image_urls[0] : null) || null,
    image_urls: Array.isArray(listing.image_urls) ? listing.image_urls : [],
    visibility: params.visibility || listing.visibility || 'private',
    status: listing.status || 'active',
    raw_payload: {
      ...baseRawPayload,
      ...(Object.keys(sourceMetadata).length ? { source_metadata: { ...((baseRawPayload as any).source_metadata || {}), ...sourceMetadata } } : {}),
    },
    source_data_expires_at: listing.source_data_expires_at || null,
    source_terms_metadata: listing.source_terms_metadata || {},
    last_seen_at: new Date().toISOString(),
  }
}

export async function insertMarketListingScore(supabase: SupabaseAny, listing: Record<string, any>, organizationId: string | null) {
  const score = scoreMarketListing(listing)
  const calculatedAt = new Date().toISOString()
  const { data: insertedScore, error } = await supabase.from('market_listing_scores').insert({
    listing_id: listing.id,
    organization_id: organizationId,
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
  if (error) throw new Error(error.message)

  if (organizationId && listing.id) {
    const review = determineDealReviewStatus(score as any, listing)
    const rank = classifyOpportunity(score.dealScore, score.rentConfidenceScore, Array.isArray(score.missingFields) && score.missingFields.length > 0)
    await supabase
      .from('market_listings')
      .update({
        deal_status: review.dealStatus,
        review_reason: review.reviewReason,
        why_this_deal: review.why,
        status: ['archived', 'converted_to_deal'].includes(String(listing.status)) ? listing.status : review.listingStatus,
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
        latest_opportunity_rank: rank.rank,
        latest_opportunity_rank_label: rank.label,
        latest_opportunity_rank_reason: rank.reason,
      })
      .eq('id', listing.id)
      .eq('organization_id', organizationId)

    await recordMarketListingActivity(supabase, {
      organizationId,
      listingId: listing.id,
      actorId: listing.created_by || null,
      eventType: 'score_calculated',
      title: 'Score calculated by import worker',
      description: `${Math.round(score.dealScore)}/100 score · rent confidence ${Math.round(score.rentConfidenceScore)}/100`,
      metadata: { dealScore: score.dealScore, rentConfidenceScore: score.rentConfidenceScore, dealStatus: review.dealStatus },
    })

    if (review.dealStatus === 'ready') {
      await createInAppNotification(supabase, {
        organizationId,
        userId: listing.created_by || null,
        type: 'opportunity_found',
        title: 'New high-score opportunity found',
        message: `${listing.title || 'A market listing'} reached ${Math.round(score.dealScore)}/100 and passed rent confidence rules.`,
        relatedEntityType: 'market_listing',
        relatedEntityId: listing.id,
        actionHref: `/market/${listing.id}`,
        metadata: { dealScore: score.dealScore, rentConfidenceScore: score.rentConfidenceScore },
      })
    } else if (review.dealStatus === 'low_confidence') {
      await createInAppNotification(supabase, {
        organizationId,
        userId: listing.created_by || null,
        type: 'rent_confidence_review',
        title: 'Rent confidence needs review',
        message: `${listing.title || 'A market listing'} needs rent review before Opportunity promotion.`,
        relatedEntityType: 'market_listing',
        relatedEntityId: listing.id,
        actionHref: `/market/${listing.id}`,
        metadata: { dealScore: score.dealScore, rentConfidenceScore: score.rentConfidenceScore },
      })
    }
  }

  return score
}

export async function upsertMarketListingFromNormalized(params: {
  supabase: SupabaseAny
  listing: NormalizedMarketListing | Record<string, any>
  organizationId: string
  userId?: string | null
  sourceId?: string | null
  importJobId?: string | null
  visibility?: string
}) {
  const payload = listingInsertPayload({
    listing: params.listing,
    organizationId: params.organizationId,
    userId: params.userId,
    sourceId: params.sourceId,
    importJobId: params.importJobId,
    visibility: params.visibility,
  })
  const dedupeKey = buildNormalizedListingKey(payload as NormalizedMarketListing)

  let existing: any = null
  if (payload.source_url) {
    const { data } = await params.supabase
      .from('market_listings')
      .select('id')
      .eq('organization_id', params.organizationId)
      .eq('source_url', payload.source_url)
      .maybeSingle()
    existing = data
  }
  if (!existing?.id && payload.external_listing_id) {
    const { data } = await params.supabase
      .from('market_listings')
      .select('id')
      .eq('organization_id', params.organizationId)
      .eq('source_type', payload.source_type)
      .eq('external_listing_id', payload.external_listing_id)
      .maybeSingle()
    existing = data
  }

  const rawPayload = {
    ...(typeof payload.raw_payload === 'object' && payload.raw_payload ? payload.raw_payload : {}),
    dedupeKey,
    importedBy: 'market_import_runner',
  }

  if (existing?.id) {
    const { data, error } = await params.supabase
      .from('market_listings')
      .update({ ...payload, raw_payload: rawPayload })
      .eq('id', existing.id)
      .select('*')
      .single()
    if (error || !data) throw new Error(error?.message || 'Could not update market listing')
    await applyAutomatedRentIntelligence({ supabase: params.supabase, listing: data as any, organizationId: params.organizationId, userId: params.userId || null, trigger: 'auto_import' })
    const { data: refreshed } = await params.supabase.from('market_listings').select('*').eq('id', data.id).maybeSingle()
    const score = await insertMarketListingScore(params.supabase, (refreshed || data) as any, params.organizationId)
    await recordMarketListingActivity(params.supabase, { organizationId: params.organizationId, listingId: data.id, actorId: params.userId || null, eventType: 'imported', title: 'Listing updated from source run', description: 'Existing listing was refreshed by the import worker.', metadata: { sourceId: params.sourceId, sourceType: payload.source_type } })
    return { listing: (refreshed || data) as any, created: false, score }
  }

  const { data, error } = await params.supabase
    .from('market_listings')
    .insert({ ...payload, raw_payload: rawPayload })
    .select('*')
    .single()
  if (error || !data) throw new Error(error?.message || 'Could not create market listing')
  await applyAutomatedRentIntelligence({ supabase: params.supabase, listing: data as any, organizationId: params.organizationId, userId: params.userId || null, trigger: 'auto_import' })
  const { data: refreshed } = await params.supabase.from('market_listings').select('*').eq('id', data.id).maybeSingle()
  const score = await insertMarketListingScore(params.supabase, (refreshed || data) as any, params.organizationId)
  await recordMarketListingActivity(params.supabase, { organizationId: params.organizationId, listingId: data.id, actorId: params.userId || null, eventType: 'imported', title: 'Listing imported from source run', description: 'New listing was created by the import worker.', metadata: { sourceId: params.sourceId, sourceType: payload.source_type } })
  return { listing: (refreshed || data) as any, created: true, score }
}


function textList(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item).trim().toLowerCase()).filter(Boolean) : []
}

function moneyNumber(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function capRateNumber(value: unknown) {
  const parsed = Number(value || 0)
  if (!Number.isFinite(parsed)) return 0
  return parsed > 1 ? parsed / 100 : parsed
}

function evaluateBuyBoxCriteria(buyBox: SourceRow | null, listing: Record<string, any>, score: Awaited<ReturnType<typeof insertMarketListingScore>>, threshold: number) {
  if (!buyBox) {
    return {
      matchScore: score.dealScore,
      matchedStatus: score.dealScore >= threshold && score.rentConfidenceScore >= OPPORTUNITY_RENT_CONFIDENCE_THRESHOLD ? 'opportunity' : 'matched',
      reasons: score.reasons,
      risks: score.risks,
      snapshot: { threshold, source: 'source_without_buy_box' },
    }
  }

  let points = 20
  const reasons: string[] = []
  const risks: string[] = []
  const price = moneyNumber(listing.list_price || listing.asking_price)
  const units = Math.max(1, Math.round(moneyNumber(listing.units || 1)))
  const sqft = moneyNumber(listing.sqft)
  const propertyTypes = textList(buyBox.property_types)
  const listingType = String(listing.property_type || '').toLowerCase()
  const city = String(listing.city || '').toLowerCase()
  const state = String(listing.state || '').toLowerCase()
  const zip = String(listing.zip_code || '').toLowerCase()
  const minRentConfidence = Number(buyBox.min_rent_confidence || OPPORTUNITY_RENT_CONFIDENCE_THRESHOLD)

  if (buyBox.city || buyBox.state || buyBox.zip_code) {
    const cityOk = !buyBox.city || city === String(buyBox.city).toLowerCase()
    const stateOk = !buyBox.state || state === String(buyBox.state).toLowerCase()
    const zipOk = !buyBox.zip_code || zip === String(buyBox.zip_code).toLowerCase()
    if (cityOk && stateOk && zipOk) {
      points += 18
      reasons.push('Location matches Buy Box.')
    } else {
      points -= 22
      risks.push('Location is outside Buy Box criteria.')
    }
  } else {
    points += 6
  }

  if (propertyTypes.length) {
    if (propertyTypes.some((type) => listingType.includes(type))) {
      points += 12
      reasons.push('Property type matches Buy Box.')
    } else {
      points -= 16
      risks.push('Property type does not match Buy Box.')
    }
  } else {
    points += 5
  }

  if (buyBox.min_price && price && price < Number(buyBox.min_price)) {
    points -= 8
    risks.push('Price is below Buy Box minimum.')
  }
  if (buyBox.max_price && price && price > Number(buyBox.max_price)) {
    points -= 24
    risks.push('Price is above Buy Box maximum.')
  }
  if (price && (!buyBox.min_price || price >= Number(buyBox.min_price)) && (!buyBox.max_price || price <= Number(buyBox.max_price))) {
    points += 12
    reasons.push('Price is inside Buy Box range.')
  }

  if (buyBox.min_units && units < Number(buyBox.min_units)) {
    points -= 10
    risks.push('Unit count is below Buy Box minimum.')
  } else if (buyBox.min_units) points += 5
  if (buyBox.max_units && units > Number(buyBox.max_units)) {
    points -= 10
    risks.push('Unit count is above Buy Box maximum.')
  } else if (buyBox.max_units) points += 5
  if (buyBox.min_sqft && sqft && sqft < Number(buyBox.min_sqft)) {
    points -= 8
    risks.push('Square footage is below Buy Box minimum.')
  }

  if (score.dealScore >= threshold) {
    points += 15
    reasons.push(`Deal score passes Buy Box threshold (${threshold}+).`)
  } else {
    points -= 15
    risks.push(`Deal score is below Buy Box threshold (${threshold}+).`)
  }

  if (score.rentConfidenceScore >= minRentConfidence) {
    points += 12
    reasons.push(`Rent confidence passes threshold (${minRentConfidence}+).`)
  } else {
    points -= 18
    risks.push(`Rent confidence is below threshold (${minRentConfidence}+).`)
  }

  if (buyBox.min_cashflow) {
    if (moneyNumber(score.estimatedMonthlyCashflow) >= Number(buyBox.min_cashflow)) {
      points += 10
      reasons.push('Cashflow meets Buy Box target.')
    } else {
      points -= 10
      risks.push('Cashflow is below Buy Box target.')
    }
  }
  if (buyBox.min_dscr) {
    if (Number(score.estimatedDscr || 0) >= Number(buyBox.min_dscr)) {
      points += 8
      reasons.push('DSCR meets Buy Box target.')
    } else {
      points -= 8
      risks.push('DSCR is below Buy Box target.')
    }
  }
  if (buyBox.min_cap_rate) {
    if (capRateNumber(score.estimatedCapRate) >= capRateNumber(buyBox.min_cap_rate)) {
      points += 8
      reasons.push('Cap rate meets Buy Box target.')
    } else {
      points -= 8
      risks.push('Cap rate is below Buy Box target.')
    }
  }
  if (buyBox.min_hud_rent_gap) {
    if (moneyNumber(score.hudRentGap) >= Number(buyBox.min_hud_rent_gap)) {
      points += 8
      reasons.push('HUD rent gap meets Buy Box target.')
    } else {
      points -= 8
      risks.push('HUD rent gap is below Buy Box target.')
    }
  }
  if (buyBox.min_market_rent_gap) {
    if (moneyNumber(score.rentGap) >= Number(buyBox.min_market_rent_gap)) {
      points += 8
      reasons.push('Market rent gap meets Buy Box target.')
    } else {
      points -= 8
      risks.push('Market rent gap is below Buy Box target.')
    }
  }

  const matchScore = Math.max(0, Math.min(100, Math.round(points)))
  const matchedStatus = score.dealScore >= threshold && score.rentConfidenceScore >= minRentConfidence && matchScore >= 70
    ? 'opportunity'
    : matchScore >= 55
      ? 'matched'
      : 'needs_review'

  return {
    matchScore,
    matchedStatus,
    reasons: reasons.length ? reasons : score.reasons,
    risks: risks.length ? risks : score.risks,
    snapshot: {
      buyBoxId: buyBox.id,
      threshold,
      minRentConfidence,
      criteria: {
        city: buyBox.city,
        state: buyBox.state,
        zip_code: buyBox.zip_code,
        property_types: buyBox.property_types,
        min_price: buyBox.min_price,
        max_price: buyBox.max_price,
        min_units: buyBox.min_units,
        max_units: buyBox.max_units,
        min_cashflow: buyBox.min_cashflow,
        min_dscr: buyBox.min_dscr,
        min_cap_rate: buyBox.min_cap_rate,
      },
    },
  }
}

export async function runMarketSourceNow(source: SourceRow, options?: { maxUrls?: number }) {
  const supabase = createSupabaseAdminClient()
  const settings = (source.settings && typeof source.settings === 'object' ? source.settings : {}) as Record<string, any>
  const maxUrls = options?.maxUrls || Number(settings.max_urls_per_run || 5) || 5
  const configuredUrls = asArrayOfUrls(settings)
  await seedSourceQueueFromSettings(supabase, source, configuredUrls)
  const queuedItems = await loadQueuedUrls(supabase, source, maxUrls)
  const urls = queuedItems.length ? queuedItems.map((item: any) => item.input_url) : configuredUrls.slice(0, maxUrls)
  const queueItemByUrl = new Map<string, any>()
  for (const item of queuedItems) queueItemByUrl.set(String(item.input_url), item)
  const threshold = Number(source.opportunity_score_threshold ?? settings.opportunity_score_threshold ?? OPPORTUNITY_SCORE_THRESHOLD)
  const { data: buyBox } = source.buy_box_id
    ? await supabase.from('market_buy_boxes').select('*').eq('id', source.buy_box_id).maybeSingle()
    : { data: null }

  if (!urls.length) {
    const message = 'No source URLs configured. Add source_url or source_urls in this source settings.'
    await supabase.from('market_sources').update({
      status: 'needs_auth',
      last_error: message,
      last_failure_at: new Date().toISOString(),
      last_run_at: new Date().toISOString(),
      next_run_at: nextRunFor(source.schedule_frequency),
    }).eq('id', source.id)
    return { sourceId: source.id, found: 0, created: 0, updated: 0, failed: 1, topScore: 0, message }
  }

  let created = 0
  let updated = 0
  let failed = 0
  let topScore = 0
  let opportunities = 0
  const listingIds: string[] = []
  const errors: string[] = []

  for (const inputUrl of urls) {
    const queueItem = queueItemByUrl.get(inputUrl)
    if (queueItem?.id) {
      await supabase.from('market_source_queue_items').update({
        status: 'running',
        attempts: Number(queueItem.attempts || 0) + 1,
        last_attempt_at: new Date().toISOString(),
      }).eq('id', queueItem.id)
    }
    const detectedSource = source.source_type || detectSourceType(inputUrl)
    const { data: job, error: jobError } = await supabase.from('market_import_jobs').insert({
      organization_id: source.organization_id,
      source_id: source.id,
      buy_box_id: source.buy_box_id || null,
      created_by: source.created_by || null,
      job_type: source.access_mode === 'api' ? 'api_sync' : source.access_mode === 'feed' ? 'source_run' : 'authorized_scrape',
      status: 'running',
      input_url: inputUrl,
      input_payload: { sourceType: detectedSource, scheduled: true, threshold },
      started_at: new Date().toISOString(),
    }).select('*').single()

    if (jobError || !job) {
      failed += 1
      errors.push(jobError?.message || 'Could not create import job')
      continue
    }

    try {
      const normalized = await fetchAndNormalizeMarketUrl(inputUrl, String(detectedSource))
      const result = await upsertMarketListingFromNormalized({
        supabase,
        listing: normalized,
        organizationId: source.organization_id,
        userId: source.created_by,
        sourceId: source.id,
        importJobId: job.id,
        visibility: source.default_visibility || settings.default_visibility || 'private',
      })
      if (result.created) created += 1
      else updated += 1
      topScore = Math.max(topScore, result.score.dealScore)
      listingIds.push(result.listing.id)

      const criteriaMatch = evaluateBuyBoxCriteria((buyBox as SourceRow | null) || null, result.listing, result.score, threshold)
      if (criteriaMatch.matchedStatus === 'opportunity') {
        opportunities += 1
        await supabase.from('market_listings').update({ status: 'opportunity' }).eq('id', result.listing.id)
      }

      if (source.buy_box_id) {
        await supabase.from('market_buy_box_matches').upsert({
          organization_id: source.organization_id,
          buy_box_id: source.buy_box_id,
          listing_id: result.listing.id,
          source_id: source.id,
          deal_score: result.score.dealScore,
          rent_confidence: result.score.rentConfidenceScore,
          rent_confidence_score: result.score.rentConfidenceScore,
          match_score: criteriaMatch.matchScore,
          matched_status: criteriaMatch.matchedStatus,
          reasons: criteriaMatch.reasons,
          risks: criteriaMatch.risks,
          criteria_snapshot: criteriaMatch.snapshot,
          matched_at: new Date().toISOString(),
        }, { onConflict: 'buy_box_id,listing_id' })
      }

      await supabase.from('market_import_jobs').update({
        status: 'completed',
        finished_at: new Date().toISOString(),
        items_found: 1,
        items_created: result.created ? 1 : 0,
        items_updated: result.created ? 0 : 1,
        items_failed: 0,
        normalized_listing_ids: [result.listing.id],
        source_summary: {
          score: result.score.dealScore,
          opportunity: criteriaMatch.matchedStatus === 'opportunity',
          matchScore: criteriaMatch.matchScore,
          rentConfidenceScore: result.score.rentConfidenceScore,
          sourceType: detectedSource,
        },
      }).eq('id', job.id)
      if (queueItem?.id) {
        await supabase.from('market_source_queue_items').update({
          status: 'completed',
          listing_id: result.listing.id,
          last_error: null,
          completed_at: new Date().toISOString(),
        }).eq('id', queueItem.id)
      }
    } catch (error) {
      failed += 1
      const message = error instanceof Error ? error.message : 'Scheduled import failed'
      errors.push(message)
      await supabase.from('market_import_jobs').update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        items_failed: 1,
        error_message: message,
        source_summary: { sourceType: detectedSource, scheduled: true },
      }).eq('id', job.id)
      if (queueItem?.id) {
        const attempts = Number(queueItem.attempts || 0) + 1
        await supabase.from('market_source_queue_items').update({
          status: attempts >= 5 ? 'failed' : 'queued',
          last_error: message,
          next_attempt_at: retryAt(attempts),
        }).eq('id', queueItem.id)
      }
    }
  }

  const runStatus = failed && created + updated ? 'active' : failed ? 'failed' : 'active'
  if (source.buy_box_id) {
    await supabase.from('market_buy_boxes').update({
      last_run_at: new Date().toISOString(),
      last_results_count: created + updated,
      last_opportunities_count: opportunities,
      last_error: errors[0] || null,
      next_run_at: nextRunFor(source.schedule_frequency),
    }).eq('id', source.buy_box_id)
  }

  await supabase.from('market_sources').update({
    status: runStatus,
    last_run_at: new Date().toISOString(),
    last_success_at: created + updated ? new Date().toISOString() : source.last_success_at,
    last_failure_at: failed ? new Date().toISOString() : source.last_failure_at,
    last_error: errors[0] || null,
    next_run_at: nextRunFor(source.schedule_frequency),
    settings: {
      ...settings,
      lastRunSummary: { created, updated, failed, opportunities, topScore, listingIds, errors: errors.slice(0, 5), ranAt: new Date().toISOString() },
    },
  }).eq('id', source.id)

  await createInAppNotification(supabase, {
    organizationId: source.organization_id,
    userId: source.created_by || null,
    type: 'buy_box_run_completed',
    title: 'Import source run completed',
    message: `${source.source_name || 'Source'} finished: ${created} created, ${updated} updated, ${opportunities} opportunities, ${failed} failed.`,
    relatedEntityType: 'market_source',
    relatedEntityId: source.id,
    actionHref: '/imports',
    metadata: { created, updated, failed, opportunities, topScore, listingIds },
  })

  return { sourceId: source.id, found: urls.length, created, updated, failed, opportunities, topScore, listingIds, errors }
}

export async function runScheduledMarketImports(options?: { limitSources?: number; maxUrlsPerSource?: number }) {
  const supabase = createSupabaseAdminClient()
  const now = new Date().toISOString()
  const { data: sources, error } = await supabase
    .from('market_sources')
    .select('*')
    .eq('status', 'active')
    .eq('auto_import_enabled', true)
    .or(`next_run_at.is.null,next_run_at.lte.${now}`)
    .order('next_run_at', { ascending: true, nullsFirst: true })
    .limit(options?.limitSources || 10)

  if (error) throw new Error(error.message)

  const results = []
  for (const source of sources || []) {
    results.push(await runMarketSourceNow(source as SourceRow, { maxUrls: options?.maxUrlsPerSource || 5 }))
  }

  return {
    ranAt: now,
    sourceCount: sources?.length || 0,
    results,
    totals: results.reduce((acc, item) => ({
      found: acc.found + item.found,
      created: acc.created + item.created,
      updated: acc.updated + item.updated,
      failed: acc.failed + item.failed,
    }), { found: 0, created: 0, updated: 0, failed: 0 }),
  }
}
