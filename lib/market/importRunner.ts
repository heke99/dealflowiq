import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { scoreMarketListing, normalizePropertyType } from '@/lib/market/scoring'
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

function nextRunFor(frequency: string | null | undefined) {
  const now = new Date()
  const value = String(frequency || 'daily')
  if (value === 'hourly') now.setHours(now.getHours() + 1)
  else if (value === 'twice_daily') now.setHours(now.getHours() + 12)
  else if (value === 'weekly') now.setDate(now.getDate() + 7)
  else now.setDate(now.getDate() + 1)
  return now.toISOString()
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
    raw_payload: listing.raw_payload || { source: 'scheduled_market_import', createdAt: new Date().toISOString() },
    last_seen_at: new Date().toISOString(),
  }
}

export async function insertMarketListingScore(supabase: SupabaseAny, listing: Record<string, any>, organizationId: string | null) {
  const score = scoreMarketListing(listing)
  const { error } = await supabase.from('market_listing_scores').insert({
    listing_id: listing.id,
    organization_id: organizationId,
    formula_version: 'market-score-v3',
    deal_score: score.dealScore,
    risk_score: score.riskScore,
    risk_level: score.riskLevel,
    data_confidence: score.dataConfidence,
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
  })
  if (error) throw new Error(error.message)
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
    const score = await insertMarketListingScore(params.supabase, data as any, params.organizationId)
    return { listing: data as any, created: false, score }
  }

  const { data, error } = await params.supabase
    .from('market_listings')
    .insert({ ...payload, raw_payload: rawPayload })
    .select('*')
    .single()
  if (error || !data) throw new Error(error?.message || 'Could not create market listing')
  const score = await insertMarketListingScore(params.supabase, data as any, params.organizationId)
  return { listing: data as any, created: true, score }
}

export async function runMarketSourceNow(source: SourceRow, options?: { maxUrls?: number }) {
  const supabase = createSupabaseAdminClient()
  const settings = (source.settings && typeof source.settings === 'object' ? source.settings : {}) as Record<string, any>
  const urls = asArrayOfUrls(settings).slice(0, options?.maxUrls || Number(settings.max_urls_per_run || 5) || 5)
  const threshold = Number(source.opportunity_score_threshold ?? settings.opportunity_score_threshold ?? 80)

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
  const listingIds: string[] = []
  const errors: string[] = []

  for (const inputUrl of urls) {
    const detectedSource = source.source_type || detectSourceType(inputUrl)
    const { data: job, error: jobError } = await supabase.from('market_import_jobs').insert({
      organization_id: source.organization_id,
      source_id: source.id,
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
          opportunity: result.score.dealScore >= threshold,
          sourceType: detectedSource,
        },
      }).eq('id', job.id)
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
    }
  }

  const runStatus = failed && created + updated ? 'active' : failed ? 'failed' : 'active'
  await supabase.from('market_sources').update({
    status: runStatus,
    last_run_at: new Date().toISOString(),
    last_success_at: created + updated ? new Date().toISOString() : source.last_success_at,
    last_failure_at: failed ? new Date().toISOString() : source.last_failure_at,
    last_error: errors[0] || null,
    next_run_at: nextRunFor(source.schedule_frequency),
    settings: {
      ...settings,
      lastRunSummary: { created, updated, failed, topScore, listingIds, errors: errors.slice(0, 5), ranAt: new Date().toISOString() },
    },
  }).eq('id', source.id)

  return { sourceId: source.id, found: urls.length, created, updated, failed, topScore, listingIds, errors }
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
