'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { canUseFeature } from '@/lib/billing/features'
import { scoreMarketListing, normalizePropertyType } from '@/lib/market/scoring'
import { runMarketSourceNow } from '@/lib/market/importRunner'
import {
  buildNormalizedListingKey,
  detectSourceType,
  discoverListingUrlsFromSearchUrl,
  fetchAndNormalizeMarketUrl,
  isSearchResultsUrl,
  parseMarketCsvText,
  type NormalizedMarketListing,
} from '@/lib/market/sourceConnectors'

function text(formData: FormData, key: string) {
  const value = String(formData.get(key) || '').trim()
  return value || null
}

function numberValue(formData: FormData, key: string) {
  const raw = String(formData.get(key) || '').trim()
  if (!raw) return null
  const parsed = Number(raw.replace(/[$,\s]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function integerValue(formData: FormData, key: string) {
  const value = numberValue(formData, key)
  return value === null ? null : Math.max(1, Math.round(value))
}

function sourceTypeValue(formData: FormData) {
  const value = String(formData.get('source_type') || 'manual')
  return ['manual', 'manual_url', 'zillow', 'crexi', 'loopnet', 'redfin', 'realtor', 'apartments', 'csv', 'partner_api', 'mls_feed', 'public_deal', 'community_deal', 'other'].includes(value) ? value : 'manual'
}

function accessModeValue(formData: FormData) {
  const value = String(formData.get('access_mode') || 'manual_url')
  return ['authorized_scrape', 'api', 'csv', 'manual_url', 'feed'].includes(value) ? value : 'manual_url'
}

function visibilityValue(formData: FormData) {
  const value = String(formData.get('visibility') || 'private')
  return value === 'team' || value === 'community' || value === 'public' ? value : 'private'
}

function imageUrlsValue(formData: FormData) {
  const raw = String(formData.get('image_urls') || '').trim()
  if (!raw) return []
  return raw
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter((item) => item.startsWith('http://') || item.startsWith('https://'))
    .slice(0, 12)
}



function sourceUrlsValue(formData: FormData) {
  const raw = String(formData.get('source_urls') || formData.get('source_url') || '').trim()
  if (!raw) return []
  return raw
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter((item) => item.startsWith('http://') || item.startsWith('https://'))
    .slice(0, 25)
}

function checkboxValue(formData: FormData, key: string) {
  return String(formData.get(key) || '') === 'on' || String(formData.get(key) || '') === 'true'
}

function scheduleFrequencyValue(formData: FormData) {
  const value = String(formData.get('schedule_frequency') || 'daily')
  return ['hourly', 'twice_daily', 'daily', 'weekly'].includes(value) ? value : 'daily'
}

function scoreThresholdValue(formData: FormData) {
  const value = numberValue(formData, 'opportunity_score_threshold')
  if (value === null) return 80
  return Math.max(0, Math.min(100, value))
}

function listingInsertPayload(params: {
  listing: NormalizedMarketListing | Record<string, any>
  organizationId: string
  userId: string
  sourceId?: string | null
  importJobId?: string | null
  visibility?: string
  status?: string
}) {
  const listing: Record<string, any> = params.listing
  return {
    organization_id: params.organizationId,
    created_by: params.userId,
    source_id: params.sourceId || null,
    import_job_id: params.importJobId || null,
    source_type: listing.source_type || 'manual',
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
    status: params.status || 'active',
    raw_payload: listing.raw_payload || { source: 'manual_market_entry', createdAt: new Date().toISOString() },
    last_seen_at: new Date().toISOString(),
  }
}

async function insertScoreForListing(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, listing: Record<string, any>, organizationId: string | null) {
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

async function upsertNormalizedListing(params: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>
  listing: NormalizedMarketListing | Record<string, any>
  organizationId: string
  userId: string
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
  }

  if (existing?.id) {
    const { data, error } = await params.supabase
      .from('market_listings')
      .update({ ...payload, raw_payload: rawPayload })
      .eq('id', existing.id)
      .select('*')
      .single()
    if (error || !data) throw new Error(error?.message || 'Could not update imported listing')
    const score = await insertScoreForListing(params.supabase, data as any, params.organizationId)
    return { listing: data as any, created: false, score }
  }

  const { data, error } = await params.supabase
    .from('market_listings')
    .insert({ ...payload, raw_payload: rawPayload })
    .select('*')
    .single()
  if (error || !data) throw new Error(error?.message || 'Could not create imported listing')
  const score = await insertScoreForListing(params.supabase, data as any, params.organizationId)
  return { listing: data as any, created: true, score }
}

function requireSourceImports(workspace: Awaited<ReturnType<typeof getCurrentWorkspace>>) {
  if (!canUseFeature(workspace.access.features, 'market_source_imports')) {
    redirect(`/market?tab=sources&error=${encodeURIComponent('Source imports are a premium feature. Upgrade to import URLs, CSV feeds and external market sources.')}`)
  }
}

export async function createMarketSourceAction(formData: FormData) {
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  requireSourceImports(workspace)

  const supabase = await createSupabaseServerClient()
  const sourceName = text(formData, 'source_name') || `${sourceTypeValue(formData)} source`
  const sourceUrls = sourceUrlsValue(formData)
  const defaultVisibility = visibilityValue(formData)
  const { data: source, error } = await supabase.from('market_sources').insert({
    organization_id: workspace.organization.id,
    created_by: workspace.user.id,
    source_type: sourceTypeValue(formData),
    source_name: sourceName,
    access_mode: accessModeValue(formData),
    status: 'active',
    rate_limit_per_day: integerValue(formData, 'rate_limit_per_day'),
    auto_import_enabled: checkboxValue(formData, 'auto_import_enabled'),
    schedule_frequency: scheduleFrequencyValue(formData),
    default_visibility: defaultVisibility,
    opportunity_score_threshold: scoreThresholdValue(formData),
    next_run_at: checkboxValue(formData, 'auto_import_enabled') ? new Date().toISOString() : null,
    settings: {
      note: text(formData, 'note'),
      source_url: sourceUrls[0] || null,
      source_urls: sourceUrls,
      max_urls_per_run: integerValue(formData, 'max_urls_per_run') || 5,
      default_visibility: defaultVisibility,
      opportunity_score_threshold: scoreThresholdValue(formData),
      createdFrom: 'market_sources_ui',
    },
  }).select('id').single()
  if (error || !source) redirect(`/market?tab=sources&error=${encodeURIComponent(error?.message || 'Could not create source')}`)

  if (sourceUrls.length) {
    await supabase.from('market_source_queue_items').upsert(sourceUrls.map((inputUrl) => ({
      organization_id: workspace.organization!.id,
      source_id: source.id,
      input_url: inputUrl,
      status: 'queued',
      priority: 50,
    })), { onConflict: 'source_id,input_url' })
  }

  revalidatePath('/market')
  redirect('/market?tab=sources&saved=source')
}

export async function importMarketUrlAction(formData: FormData) {
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  requireSourceImports(workspace)

  const inputUrl = text(formData, 'input_url') || text(formData, 'source_url')
  if (!inputUrl || !inputUrl.startsWith('http')) redirect(`/market?tab=sources&error=${encodeURIComponent('Enter a valid source URL.')}`)
  const visibility = visibilityValue(formData)
  const sourceId = text(formData, 'source_id')
  const requestedSourceType = sourceTypeValue(formData)
  const sourceType = requestedSourceType === 'manual' || requestedSourceType === 'manual_url' ? detectSourceType(inputUrl) : requestedSourceType
  const supabase = await createSupabaseServerClient()
  const searchMode = isSearchResultsUrl(inputUrl)

  const { data: job, error: jobError } = await supabase.from('market_import_jobs').insert({
    organization_id: workspace.organization.id,
    source_id: sourceId,
    created_by: workspace.user.id,
    job_type: searchMode ? 'search_url_import' : sourceType === 'manual_url' ? 'manual_url' : 'authorized_scrape',
    status: 'running',
    input_url: inputUrl,
    input_payload: { sourceType, visibility, searchMode, startedFrom: 'market_import_url_action' },
    started_at: new Date().toISOString(),
  }).select('*').single()

  if (jobError || !job) redirect(`/market?tab=sources&error=${encodeURIComponent(jobError?.message || 'Could not create import job')}`)

  let found = 0
  let created = 0
  let updated = 0
  let failed = 0
  let topScore = 0
  const listingIds: string[] = []
  const rowErrors: Array<{ url: string; error: string }> = []
  const previewRows: Array<Record<string, unknown>> = []

  try {
    const discovered = searchMode
      ? await discoverListingUrlsFromSearchUrl(inputUrl, String(sourceType), 10)
      : [{ url: inputUrl, sourceType, sourceUrl: inputUrl, order: 1 }]

    found = discovered.length
    if (!found) throw new Error('No listing URLs were found in that search URL. Try a direct listing URL or verify provider access for this search page.')

    for (const item of discovered.slice(0, 10)) {
      const rowStartedAt = new Date().toISOString()
      try {
        const normalized = await fetchAndNormalizeMarketUrl(item.url, String(item.sourceType || sourceType))
        const previewIndex = previewRows.push({
          status: 'parsed',
          source_url: item.url,
          title: normalized.title,
          address: normalized.address,
          city: normalized.city,
          state: normalized.state,
          zip_code: normalized.zip_code,
          list_price: normalized.list_price,
          bedrooms: normalized.bedrooms,
          bathrooms: normalized.bathrooms,
          sqft: normalized.sqft,
          source_type: normalized.source_type,
          started_at: rowStartedAt,
        }) - 1
        const result = await upsertNormalizedListing({
          supabase,
          listing: normalized,
          organizationId: workspace.organization.id,
          userId: workspace.user.id,
          sourceId,
          importJobId: job.id,
          visibility,
        })
        listingIds.push(result.listing.id)
        if (result.created) created += 1
        else updated += 1
        const score = Number(result.score?.dealScore || 0)
        topScore = Math.max(topScore, score)
        previewRows[previewIndex] = {
          ...previewRows[previewIndex],
          status: result.created ? 'created' : 'updated',
          listing_id: result.listing.id,
          deal_score: score,
          opportunity: score >= 80,
          imported_at: new Date().toISOString(),
        }
      } catch (error) {
        failed += 1
        const message = error instanceof Error ? error.message : 'Listing import failed'
        rowErrors.push({ url: item.url, error: message })
        previewRows.push({ status: 'failed', source_url: item.url, error: message, started_at: rowStartedAt })
      }
    }

    const completedStatus = failed && created + updated ? 'partial' : failed ? 'failed' : 'completed'
    await supabase.from('market_import_jobs').update({
      status: completedStatus,
      finished_at: new Date().toISOString(),
      items_found: found,
      items_created: created,
      items_updated: updated,
      items_failed: failed,
      error_message: rowErrors.length ? `${failed} listing${failed === 1 ? '' : 's'} failed. Open job details below for row errors.` : null,
      normalized_listing_ids: listingIds,
      source_summary: {
        sourceType,
        searchMode,
        topScore,
        opportunity: topScore >= 80,
        discoveredUrls: discovered.map((item) => item.url),
        previewRows,
        rowErrors,
      },
    }).eq('id', job.id)

    await supabase.from('audit_logs').insert({
      organization_id: workspace.organization.id,
      actor_id: workspace.user.id,
      event_type: searchMode ? 'market_import.search.completed' : 'market_import.url.completed',
      entity_type: 'market_import_job',
      entity_id: job.id,
      metadata: { sourceType, inputUrl, found, created, updated, failed, listingIds, rowErrors },
    })

    revalidatePath('/market')
    revalidatePath('/opportunities')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not import listing URL'
    await supabase.from('market_import_jobs').update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      items_found: found,
      items_created: created,
      items_updated: updated,
      items_failed: Math.max(1, failed),
      error_message: message,
      normalized_listing_ids: listingIds,
      source_summary: { sourceType, searchMode, topScore, rowErrors, previewRows },
    }).eq('id', job.id)
    redirect(`/market?tab=sources&import_job_id=${job.id}&error=${encodeURIComponent(message)}`)
  }

  const targetTab = topScore >= 80 ? 'opportunities' : 'all'
  redirect(`/market?tab=${targetTab}&import_job_id=${job.id}&saved=imported`)
}

export async function importMarketCsvAction(formData: FormData) {
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  requireSourceImports(workspace)

  const rawCsv = String(formData.get('csv_text') || '').trim()
  if (!rawCsv) redirect(`/market?tab=sources&error=${encodeURIComponent('Paste CSV text first.')}`)
  const visibility = visibilityValue(formData)
  const sourceId = text(formData, 'source_id')
  const supabase = await createSupabaseServerClient()

  const { data: job, error: jobError } = await supabase.from('market_import_jobs').insert({
    organization_id: workspace.organization.id,
    source_id: sourceId,
    created_by: workspace.user.id,
    job_type: 'csv_upload',
    status: 'running',
    input_payload: { visibility, rowPreview: rawCsv.slice(0, 500) },
    started_at: new Date().toISOString(),
  }).select('*').single()
  if (jobError || !job) redirect(`/market?tab=sources&error=${encodeURIComponent(jobError?.message || 'Could not create CSV import job')}`)

  try {
    const listings = parseMarketCsvText(rawCsv, 'csv')
    if (!listings.length) throw new Error('No valid CSV rows found. Include a header row, for example: title,address,city,state,zip,list_price,market_rent,primary_image_url')
    let created = 0
    let updated = 0
    let failed = 0
    for (const listing of listings.slice(0, 100)) {
      try {
        const result = await upsertNormalizedListing({
          supabase,
          listing,
          organizationId: workspace.organization.id,
          userId: workspace.user.id,
          sourceId,
          importJobId: job.id,
          visibility,
        })
        if (result.created) created += 1
        else updated += 1
      } catch {
        failed += 1
      }
    }

    await supabase.from('market_import_jobs').update({
      status: failed && created + updated ? 'partial' : failed ? 'failed' : 'completed',
      finished_at: new Date().toISOString(),
      items_found: listings.length,
      items_created: created,
      items_updated: updated,
      items_failed: failed,
      error_message: failed ? `${failed} rows failed during import.` : null,
    }).eq('id', job.id)

    revalidatePath('/market')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not import CSV listings'
    await supabase.from('market_import_jobs').update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      error_message: message,
    }).eq('id', job.id)
    redirect(`/market?tab=sources&error=${encodeURIComponent(message)}`)
  }

  redirect(`/market?tab=all&import_job_id=${job.id}&saved=csv_imported`)
}

export async function createMarketListingAction(formData: FormData) {
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')

  const sourceUrl = text(formData, 'source_url')
  const title = text(formData, 'title') || text(formData, 'address') || 'Untitled opportunity'
  const imageUrls = imageUrlsValue(formData)
  const listingPayload = {
    source_type: sourceTypeValue(formData),
    external_listing_id: text(formData, 'external_listing_id'),
    source_url: sourceUrl,
    title,
    address: text(formData, 'address'),
    city: text(formData, 'city'),
    state: text(formData, 'state'),
    zip_code: text(formData, 'zip_code'),
    county: text(formData, 'county'),
    property_type: normalizePropertyType(text(formData, 'property_type')),
    units: integerValue(formData, 'units') || 1,
    bedrooms: numberValue(formData, 'bedrooms'),
    bathrooms: numberValue(formData, 'bathrooms'),
    sqft: integerValue(formData, 'sqft'),
    lot_size: text(formData, 'lot_size'),
    year_built: integerValue(formData, 'year_built'),
    list_price: numberValue(formData, 'list_price') || numberValue(formData, 'asking_price'),
    asking_price: numberValue(formData, 'asking_price') || numberValue(formData, 'list_price'),
    arv: numberValue(formData, 'arv'),
    rehab_estimate: numberValue(formData, 'rehab_estimate'),
    current_rent: numberValue(formData, 'current_rent'),
    market_rent: numberValue(formData, 'market_rent'),
    hud_rent: numberValue(formData, 'hud_rent'),
    estimated_rent: numberValue(formData, 'estimated_rent'),
    taxes_annual: numberValue(formData, 'taxes_annual'),
    insurance_annual: numberValue(formData, 'insurance_annual'),
    hoa_monthly: numberValue(formData, 'hoa_monthly'),
    utilities_monthly: numberValue(formData, 'utilities_monthly'),
    description: text(formData, 'description'),
    broker_name: text(formData, 'broker_name'),
    broker_phone: text(formData, 'broker_phone'),
    broker_email: text(formData, 'broker_email'),
    primary_image_url: text(formData, 'primary_image_url') || imageUrls[0] || null,
    image_urls: imageUrls,
    visibility: visibilityValue(formData),
    status: 'active',
    raw_payload: { source: 'manual_market_entry', createdAt: new Date().toISOString() },
  }

  const supabase = await createSupabaseServerClient()

  if (sourceUrl) {
    const { data: existing } = await supabase
      .from('market_listings')
      .select('id')
      .eq('organization_id', workspace.organization.id)
      .eq('source_url', sourceUrl)
      .maybeSingle()
    if (existing?.id) redirect(`/market?tab=all&error=${encodeURIComponent('That source URL already exists in Market.')}`)
  }

  try {
    const result = await upsertNormalizedListing({
      supabase,
      listing: listingPayload,
      organizationId: workspace.organization.id,
      userId: workspace.user.id,
      visibility: listingPayload.visibility,
    })

    await supabase.from('audit_logs').insert({
      organization_id: workspace.organization.id,
      actor_id: workspace.user.id,
      event_type: 'market_listing.created',
      entity_type: 'market_listing',
      entity_id: result.listing.id,
      metadata: { source_type: result.listing.source_type, source_url: result.listing.source_url },
    })

    revalidatePath('/market')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not create market listing'
    redirect(`/market?tab=sources&error=${encodeURIComponent(message)}`)
  }

  redirect('/market?tab=all&saved=listing')
}

export async function rescoreMarketListingAction(formData: FormData) {
  const listingId = String(formData.get('listing_id') || '').trim()
  if (!listingId) redirect('/market?error=Missing listing id')
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  const supabase = await createSupabaseServerClient()
  const { data: listing, error } = await supabase
    .from('market_listings')
    .select('*')
    .eq('id', listingId)
    .maybeSingle()
  if (error || !listing) redirect(`/market?error=${encodeURIComponent(error?.message || 'Listing not found')}`)
  await insertScoreForListing(supabase, listing as any, (listing as any).organization_id || workspace.organization.id)
  revalidatePath('/market')
  redirect(`/market/${listingId}?saved=rescore`)
}

export async function saveOpportunityAction(formData: FormData) {
  const listingId = String(formData.get('listing_id') || '').trim()
  const status = String(formData.get('status') || 'saved')
  const safeStatus = ['saved', 'watching', 'interested', 'contacted', 'analyzing', 'converted_to_deal', 'ignored', 'passed', 'under_contract'].includes(status) ? status : 'saved'
  if (!listingId) redirect('/market?error=Missing listing id')
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.from('market_watchlist').upsert({
    organization_id: workspace.organization.id,
    user_id: workspace.user.id,
    listing_id: listingId,
    status: safeStatus,
  }, { onConflict: 'organization_id,user_id,listing_id' })
  if (error) redirect(`/market?error=${encodeURIComponent(error.message)}`)
  revalidatePath('/market')
  redirect(`/market?tab=${safeStatus === 'ignored' || safeStatus === 'passed' ? 'ignored' : 'saved'}&saved=${safeStatus}`)
}

export async function convertListingToDealAction(formData: FormData) {
  const listingId = String(formData.get('listing_id') || '').trim()
  if (!listingId) redirect('/market?error=Missing listing id')
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  const supabase = await createSupabaseServerClient()
  const { data: listing, error: listingError } = await supabase
    .from('market_listings')
    .select('*')
    .eq('id', listingId)
    .maybeSingle()
  if (listingError || !listing) redirect(`/market?error=${encodeURIComponent(listingError?.message || 'Listing not found')}`)

  const row = listing as any
  const { data: deal, error: dealError } = await supabase.from('deals').insert({
    organization_id: workspace.organization.id,
    created_by: workspace.user.id,
    assigned_user_id: workspace.user.id,
    title: row.title || row.address || 'Market opportunity',
    status: 'imported',
    source_url: row.source_url,
    source_platform: row.source_type,
    primary_image_url: row.primary_image_url,
    image_urls: row.image_urls || [],
    visibility: 'private',
    property_type: row.property_type,
    asking_price: row.asking_price || row.list_price,
    purchase_price: row.list_price || row.asking_price,
    arv: row.arv,
    rehab_estimate: row.rehab_estimate,
    current_rent: row.current_rent || row.estimated_rent,
    market_rent: row.market_rent,
    section8_rent: row.hud_rent,
    taxes_annual: row.taxes_annual,
    insurance_annual: row.insurance_annual,
    hoa_monthly: row.hoa_monthly,
    utilities_monthly: row.utilities_monthly,
    notes: row.description,
  }).select('id').single()
  if (dealError || !deal) redirect(`/market?error=${encodeURIComponent(dealError?.message || 'Could not convert listing')}`)

  const { error: propertyError } = await supabase.from('properties').insert({
    organization_id: workspace.organization.id,
    deal_id: deal.id,
    address: row.address,
    city: row.city,
    state: row.state,
    zip_code: row.zip_code,
    county: row.county,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    square_feet: row.sqft,
    lot_size: row.lot_size,
    year_built: row.year_built,
    number_of_units: row.units || 1,
  })
  if (propertyError) redirect(`/deals/${deal.id}/edit?error=${encodeURIComponent(propertyError.message)}`)

  await supabase.from('market_watchlist').upsert({
    organization_id: workspace.organization.id,
    user_id: workspace.user.id,
    listing_id: listingId,
    status: 'converted_to_deal',
  }, { onConflict: 'organization_id,user_id,listing_id' })
  await supabase.from('market_listings').update({ status: 'converted_to_deal' }).eq('id', listingId)

  revalidatePath('/market')
  revalidatePath('/deals')
  redirect(`/deals/${deal.id}?saved=converted`)
}


export async function runMarketSourceAction(formData: FormData) {
  const sourceId = String(formData.get('source_id') || '').trim()
  if (!sourceId) redirect('/market?tab=sources&error=Missing source id')

  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  if (!canUseFeature(workspace.access.features, 'scheduled_market_imports') && !workspace.access.isPlatformAdmin) {
    redirect(`/market?tab=sources&error=${encodeURIComponent('Scheduled/source runs are a premium feature.')}`)
  }

  const supabase = await createSupabaseServerClient()
  const { data: source, error } = await supabase
    .from('market_sources')
    .select('*')
    .eq('id', sourceId)
    .eq('organization_id', workspace.organization.id)
    .maybeSingle()
  if (error || !source) redirect(`/market?tab=sources&error=${encodeURIComponent(error?.message || 'Source not found')}`)

  try {
    await runMarketSourceNow(source as any, { maxUrls: 5 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not run market source'
    redirect(`/market?tab=sources&error=${encodeURIComponent(message)}`)
  }

  revalidatePath('/market')
  redirect('/market?tab=opportunities&saved=source_run')
}

export async function publishDealToMarketAction(formData: FormData) {
  const dealId = String(formData.get('deal_id') || '').trim()
  if (!dealId) redirect('/deals?error=Missing deal id')
  const visibility = visibilityValue(formData)
  if (visibility === 'private') redirect(`/deals/${dealId}?error=${encodeURIComponent('Choose Team, Community, or Public to publish a deal.')}`)
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  if ((visibility === 'community' || visibility === 'public') && !canUseFeature(workspace.access.features, 'public_community_deals')) {
    redirect(`/deals/${dealId}?error=${encodeURIComponent('Public/community deal posting is a premium feature.')}`)
  }
  const supabase = await createSupabaseServerClient()
  const { data: deal, error: dealError } = await supabase
    .from('deals')
    .select('*, properties(*)')
    .eq('id', dealId)
    .eq('organization_id', workspace.organization.id)
    .maybeSingle()
  if (dealError || !deal) redirect(`/deals/${dealId}?error=${encodeURIComponent(dealError?.message || 'Deal not found')}`)
  const property = Array.isArray((deal as any).properties) ? (deal as any).properties[0] : (deal as any).properties

  const publishedAt = new Date().toISOString()
  const { error: updateError } = await supabase.from('deals').update({
    visibility,
    published_at: publishedAt,
    expires_at: text(formData, 'expires_at'),
  }).eq('id', dealId).eq('organization_id', workspace.organization.id)
  if (updateError) redirect(`/deals/${dealId}?error=${encodeURIComponent(updateError.message)}`)

  const title = text(formData, 'title') || (deal as any).title
  const postPayload = {
    deal_id: dealId,
    organization_id: workspace.organization.id,
    created_by: workspace.user.id,
    visibility,
    community_id: text(formData, 'community_id'),
    title,
    summary: text(formData, 'summary') || (deal as any).notes,
    asking_price: numberValue(formData, 'asking_price') || (deal as any).asking_price || (deal as any).purchase_price,
    assignment_fee: numberValue(formData, 'assignment_fee'),
    contact_name: text(formData, 'contact_name'),
    contact_email: text(formData, 'contact_email') || workspace.user.email,
    contact_phone: text(formData, 'contact_phone'),
    status: 'published',
    expires_at: text(formData, 'expires_at'),
    published_at: publishedAt,
  }

  const { data: existingPost } = await supabase
    .from('public_deal_posts')
    .select('id')
    .eq('deal_id', dealId)
    .eq('visibility', visibility)
    .maybeSingle()

  const { error: postError } = existingPost?.id
    ? await supabase.from('public_deal_posts').update(postPayload).eq('id', existingPost.id)
    : await supabase.from('public_deal_posts').insert(postPayload)
  if (postError) redirect(`/deals/${dealId}?error=${encodeURIComponent(postError.message)}`)

  const listingPayload = {
    source_type: visibility === 'community' ? 'community_deal' : 'public_deal',
    external_listing_id: dealId,
    source_url: (deal as any).source_url,
    title,
    address: property?.address,
    city: property?.city,
    state: property?.state,
    zip_code: property?.zip_code,
    county: property?.county,
    property_type: (deal as any).property_type,
    units: property?.number_of_units || 1,
    bedrooms: property?.bedrooms,
    bathrooms: property?.bathrooms,
    sqft: property?.square_feet,
    lot_size: property?.lot_size,
    year_built: property?.year_built,
    list_price: (deal as any).asking_price || (deal as any).purchase_price,
    asking_price: (deal as any).asking_price || (deal as any).purchase_price,
    arv: (deal as any).arv,
    rehab_estimate: (deal as any).rehab_estimate,
    current_rent: (deal as any).current_rent,
    market_rent: (deal as any).market_rent,
    hud_rent: (deal as any).section8_rent,
    taxes_annual: (deal as any).taxes_annual,
    insurance_annual: (deal as any).insurance_annual,
    hoa_monthly: (deal as any).hoa_monthly,
    utilities_monthly: (deal as any).utilities_monthly,
    description: text(formData, 'summary') || (deal as any).notes,
    primary_image_url: (deal as any).primary_image_url,
    image_urls: (deal as any).image_urls || [],
    visibility,
    status: 'active',
    raw_payload: { source: 'published_deal', dealId, createdAt: publishedAt },
  }

  try {
    await upsertNormalizedListing({
      supabase,
      listing: listingPayload,
      organizationId: workspace.organization.id,
      userId: workspace.user.id,
      visibility,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not publish deal listing'
    redirect(`/deals/${dealId}?error=${encodeURIComponent(message)}`)
  }

  revalidatePath('/market')
  revalidatePath(`/deals/${dealId}`)
  redirect(`/market?tab=${visibility === 'public' ? 'public' : visibility === 'community' ? 'community' : 'all'}&saved=published`)
}

export async function archiveMarketListingAction(formData: FormData) {
  const listingId = String(formData.get('listing_id') || '').trim()
  const returnTo = String(formData.get('return_to') || '/market').trim() || '/market'
  if (!listingId) redirect('/market?error=Missing listing id')
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  const supabase = await createSupabaseServerClient()

  const { data: listing, error: listingError } = await supabase
    .from('market_listings')
    .select('id,organization_id,created_by,visibility')
    .eq('id', listingId)
    .maybeSingle()
  if (listingError || !listing) redirect(`${returnTo}?error=${encodeURIComponent(listingError?.message || 'Listing not found')}`)

  const row = listing as any
  const isOwner = row.created_by === workspace.user.id
  const isOrgAdmin = Boolean(workspace.access.isPlatformAdmin)
  if (!isOwner && !isOrgAdmin) {
    redirect(`${returnTo}?error=${encodeURIComponent('Only the listing owner or an admin can remove this listing from Market.')}`)
  }

  const { error } = await supabase
    .from('market_listings')
    .update({ status: 'archived', archived_at: new Date().toISOString(), archived_by: workspace.user.id })
    .eq('id', listingId)
  if (error) redirect(`${returnTo}?error=${encodeURIComponent(error.message)}`)

  revalidatePath('/market')
  revalidatePath('/opportunities')
  revalidatePath('/saved-deals')
  redirect(`${returnTo}?saved=listing_archived`)
}

async function loadWorkspaceMarketListing(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  listingId: string,
  organizationId: string,
) {
  const { data, error } = await supabase
    .from('market_listings')
    .select('*')
    .eq('id', listingId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (error || !data) throw new Error(error?.message || 'Listing not found')
  return data as Record<string, any>
}

function safeReturnPath(value: FormDataEntryValue | null, fallback: string) {
  const path = String(value || fallback).trim()
  return path.startsWith('/') ? path : fallback
}

function safeDealStatus(value: FormDataEntryValue | null) {
  const status = String(value || 'needs_review')
  return ['ready', 'needs_review', 'missing_data', 'low_confidence', 'archived'].includes(status) ? status : 'needs_review'
}

function safeDealStage(value: FormDataEntryValue | null) {
  const stage = String(value || 'needs_review')
  return ['imported', 'needs_review', 'analyzed', 'watchlist', 'opportunity', 'underwriting', 'offer_made', 'rejected', 'archived'].includes(stage) ? stage : 'needs_review'
}

function safeOverrideField(value: FormDataEntryValue | null) {
  const field = String(value || 'market_rent')
  return ['market_rent', 'hud_rent', 'estimated_rent', 'current_rent', 'list_price', 'asking_price', 'rehab_estimate', 'taxes_annual', 'insurance_annual'].includes(field) ? field : 'market_rent'
}

async function createListingActivityIfAvailable(params: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>
  organizationId: string
  listingId: string
  actorId: string
  eventType: string
  title: string
  description?: string | null
  metadata?: Record<string, any>
}) {
  await params.supabase.from('market_listing_activity').insert({
    organization_id: params.organizationId,
    listing_id: params.listingId,
    actor_id: params.actorId,
    event_type: params.eventType,
    title: params.title,
    description: params.description || null,
    metadata: params.metadata || {},
  })
}

async function createNotificationIfAvailable(params: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>
  organizationId: string
  userId: string
  actorId: string
  type: string
  title: string
  message: string
  listingId: string
}) {
  await params.supabase.from('in_app_notifications').insert({
    organization_id: params.organizationId,
    user_id: params.userId,
    actor_id: params.actorId,
    type: params.type,
    title: params.title,
    message: params.message,
    related_entity_type: 'market_listing',
    related_entity_id: params.listingId,
    action_href: `/market/${params.listingId}`,
    metadata: {},
  })
}

async function rescoreAndRefreshListing(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  listingId: string,
  organizationId: string,
) {
  const listing = await loadWorkspaceMarketListing(supabase, listingId, organizationId)
  await insertScoreForListing(supabase, listing, organizationId)
  return listing
}

export async function addMarketListingNoteAction(formData: FormData) {
  const listingId = String(formData.get('listing_id') || '').trim()
  const note = text(formData, 'note')
  const noteTypeRaw = String(formData.get('note_type') || 'internal')
  const noteType = ['internal', 'seller_call', 'buyer_feedback', 'underwriting', 'offer', 'risk'].includes(noteTypeRaw) ? noteTypeRaw : 'internal'
  if (!listingId) redirect('/market?error=Missing listing id')
  if (!note) redirect(`/market/${listingId}?error=${encodeURIComponent('Write a note first.')}`)

  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase.from('market_listing_notes').insert({
    organization_id: workspace.organization.id,
    listing_id: listingId,
    created_by: workspace.user.id,
    note,
    note_type: noteType,
  })
  if (error) redirect(`/market/${listingId}?error=${encodeURIComponent(error.message)}`)

  await createListingActivityIfAvailable({
    supabase,
    organizationId: workspace.organization.id,
    listingId,
    actorId: workspace.user.id,
    eventType: 'note_added',
    title: 'Note added',
    description: note.slice(0, 180),
    metadata: { noteType },
  }).catch(() => null)

  revalidatePath(`/market/${listingId}`)
  redirect(`/market/${listingId}?saved=note`)
}

export async function updateMarketListingReviewStatusAction(formData: FormData) {
  const listingId = String(formData.get('listing_id') || '').trim()
  const dealStatus = safeDealStatus(formData.get('deal_status'))
  const reviewReason = text(formData, 'review_reason') || `Review status changed to ${dealStatus.replaceAll('_', ' ')}.`
  const returnTo = safeReturnPath(formData.get('return_to'), `/market/${listingId}`)
  if (!listingId) redirect('/market?error=Missing listing id')

  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  const supabase = await createSupabaseServerClient()
  const status = dealStatus === 'ready' ? 'opportunity' : dealStatus === 'archived' ? 'archived' : 'needs_review'
  const dealStage = dealStatus === 'ready' ? 'opportunity' : dealStatus === 'archived' ? 'archived' : 'needs_review'

  const { error } = await supabase
    .from('market_listings')
    .update({
      deal_status: dealStatus,
      deal_stage: dealStage,
      status,
      review_reason: reviewReason,
      last_reviewed_at: new Date().toISOString(),
      last_reviewed_by: workspace.user.id,
    })
    .eq('id', listingId)
    .eq('organization_id', workspace.organization.id)
  if (error) redirect(`/market/${listingId}?error=${encodeURIComponent(error.message)}`)

  await createListingActivityIfAvailable({
    supabase,
    organizationId: workspace.organization.id,
    listingId,
    actorId: workspace.user.id,
    eventType: dealStatus === 'ready' ? 'marked_opportunity' : 'review_updated',
    title: `Review status: ${dealStatus.replaceAll('_', ' ')}`,
    description: reviewReason,
    metadata: { dealStatus, status, dealStage },
  }).catch(() => null)

  await createNotificationIfAvailable({
    supabase,
    organizationId: workspace.organization.id,
    userId: workspace.user.id,
    actorId: workspace.user.id,
    type: 'deal_status_changed',
    title: 'Deal review status updated',
    message: reviewReason,
    listingId,
  }).catch(() => null)

  revalidatePath('/market')
  revalidatePath('/opportunities')
  revalidatePath('/saved-deals')
  revalidatePath(`/market/${listingId}`)
  redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}saved=review`)
}

export async function updateMarketListingStageAction(formData: FormData) {
  const listingId = String(formData.get('listing_id') || '').trim()
  const dealStage = safeDealStage(formData.get('deal_stage'))
  if (!listingId) redirect('/market?error=Missing listing id')

  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('market_listings')
    .update({ deal_stage: dealStage })
    .eq('id', listingId)
    .eq('organization_id', workspace.organization.id)
  if (error) redirect(`/market/${listingId}?error=${encodeURIComponent(error.message)}`)

  await createListingActivityIfAvailable({
    supabase,
    organizationId: workspace.organization.id,
    listingId,
    actorId: workspace.user.id,
    eventType: 'stage_updated',
    title: `Stage: ${dealStage.replaceAll('_', ' ')}`,
    metadata: { dealStage },
  }).catch(() => null)

  revalidatePath('/market')
  revalidatePath(`/market/${listingId}`)
  redirect(`/market/${listingId}?saved=stage`)
}

export async function runListingMarketRentAction(formData: FormData) {
  const listingId = String(formData.get('listing_id') || '').trim()
  if (!listingId) redirect('/market?error=Missing listing id')

  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  const supabase = await createSupabaseServerClient()

  try {
    const listing = await loadWorkspaceMarketListing(supabase, listingId, workspace.organization.id)
    const beds = Number(listing.bedrooms || 3)
    const sqft = Number(listing.sqft || 0)
    const base = beds <= 1 ? 1050 : beds === 2 ? 1300 : beds === 3 ? 1600 : 1850
    const sqftAdjustment = sqft > 0 ? Math.min(450, Math.max(-200, Math.round((sqft - 1200) * 0.18))) : 0
    const estimatedRent = Math.max(650, base + sqftAdjustment)
    const confidence = listing.zip_code && listing.bedrooms ? (listing.sqft ? 72 : 62) : 45
    const { data, error } = await supabase
      .from('market_listings')
      .update({
        market_rent: listing.market_rent || estimatedRent,
        estimated_rent: estimatedRent,
        rent_confidence_score: confidence,
        review_reason: confidence < 65 ? 'Market rent estimated, but confidence is low. Review manually.' : 'Market rent estimated from listing facts.',
        deal_status: confidence < 65 ? 'low_confidence' : listing.deal_status || 'needs_review',
      })
      .eq('id', listingId)
      .eq('organization_id', workspace.organization.id)
      .select('*')
      .single()
    if (error || !data) throw new Error(error?.message || 'Could not update market rent')
    await insertScoreForListing(supabase, data as any, workspace.organization.id)
  } catch (error) {
    redirect(`/market/${listingId}?error=${encodeURIComponent(error instanceof Error ? error.message : 'Market rent analysis failed')}`)
  }

  revalidatePath('/market')
  revalidatePath(`/market/${listingId}`)
  redirect(`/market/${listingId}?saved=market_rent`)
}

export async function runListingHudLookupAction(formData: FormData) {
  const listingId = String(formData.get('listing_id') || '').trim()
  if (!listingId) redirect('/market?error=Missing listing id')

  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  const supabase = await createSupabaseServerClient()

  try {
    const listing = await loadWorkspaceMarketListing(supabase, listingId, workspace.organization.id)
    const beds = Math.max(0, Math.min(4, Math.round(Number(listing.bedrooms || 2))))
    const fmrByBeds = [950, 1100, 1350, 1650, 1950]
    const selectedFmr = fmrByBeds[beds]
    const { error: hudSnapshotError } = await supabase.from('listing_hud_rent_snapshots').insert({
      organization_id: workspace.organization.id,
      listing_id: listingId,
      state: listing.state || null,
      county: listing.county || null,
      zip: listing.zip_code || null,
      bedrooms: beds,
      hud_year: new Date().getFullYear(),
      fmr_0br: fmrByBeds[0],
      fmr_1br: fmrByBeds[1],
      fmr_2br: fmrByBeds[2],
      fmr_3br: fmrByBeds[3],
      fmr_4br: fmrByBeds[4],
      selected_fmr: selectedFmr,
      lookup_status: listing.zip_code ? 'estimated' : 'needs_review',
      raw_payload: { source: 'internal_fmr_estimator', note: 'Replace with live HUD/FMR dataset lookup when provider endpoint is configured.' },
    })
    if (hudSnapshotError) console.warn('HUD snapshot insert skipped:', hudSnapshotError.message)
    const { data, error } = await supabase
      .from('market_listings')
      .update({ hud_rent: selectedFmr, rent_confidence_score: listing.zip_code ? 70 : 50 })
      .eq('id', listingId)
      .eq('organization_id', workspace.organization.id)
      .select('*')
      .single()
    if (error || !data) throw new Error(error?.message || 'Could not update HUD/FMR rent')
    await insertScoreForListing(supabase, data as any, workspace.organization.id)
  } catch (error) {
    redirect(`/market/${listingId}?error=${encodeURIComponent(error instanceof Error ? error.message : 'HUD/FMR lookup failed')}`)
  }

  revalidatePath('/market')
  revalidatePath(`/market/${listingId}`)
  redirect(`/market/${listingId}?saved=hud`)
}

export async function runListingFullIntelligenceAction(formData: FormData) {
  const listingId = String(formData.get('listing_id') || '').trim()
  if (!listingId) redirect('/market?error=Missing listing id')

  const marketRentForm = new FormData()
  marketRentForm.set('listing_id', listingId)
  await runListingMarketRentAction(marketRentForm)
}

export async function addListingManualOverrideAction(formData: FormData) {
  const listingId = String(formData.get('listing_id') || '').trim()
  const fieldName = safeOverrideField(formData.get('field_name'))
  const newValueRaw = String(formData.get('new_value') || '').trim()
  const reason = text(formData, 'reason') || 'Manual underwriting override.'
  if (!listingId || !newValueRaw) redirect(`/market/${listingId || ''}?error=${encodeURIComponent('Manual override needs a value.')}`)

  const newValueNumber = Number(newValueRaw.replace(/[$,\s]/g, ''))
  if (!Number.isFinite(newValueNumber)) redirect(`/market/${listingId}?error=${encodeURIComponent('Manual override value must be a number.')}`)

  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  const supabase = await createSupabaseServerClient()

  try {
    const listing = await loadWorkspaceMarketListing(supabase, listingId, workspace.organization.id)
    const oldValue = listing[fieldName] == null ? null : String(listing[fieldName])
    const { error: overrideInsertError } = await supabase.from('listing_manual_overrides').insert({
      organization_id: workspace.organization.id,
      listing_id: listingId,
      field_name: fieldName,
      old_value: oldValue,
      new_value: String(newValueNumber),
      reason,
      apply_to_score: checkboxValue(formData, 'apply_to_score') || String(formData.get('apply_to_score') || '') === 'on',
      created_by: workspace.user.id,
    })
    if (overrideInsertError) console.warn('Manual override history insert skipped:', overrideInsertError.message)
    const { data, error } = await supabase
      .from('market_listings')
      .update({ [fieldName]: newValueNumber, review_reason: `Manual override applied to ${fieldName}: ${reason}` })
      .eq('id', listingId)
      .eq('organization_id', workspace.organization.id)
      .select('*')
      .single()
    if (error || !data) throw new Error(error?.message || 'Manual override update failed')
    await insertScoreForListing(supabase, data as any, workspace.organization.id)
    await createListingActivityIfAvailable({
      supabase,
      organizationId: workspace.organization.id,
      listingId,
      actorId: workspace.user.id,
      eventType: 'manual_override_added',
      title: 'Manual override added',
      description: `${fieldName} changed from ${oldValue || 'blank'} to ${newValueNumber}. ${reason}`,
      metadata: { fieldName, oldValue, newValue: newValueNumber },
    }).catch(() => null)
  } catch (error) {
    redirect(`/market/${listingId}?error=${encodeURIComponent(error instanceof Error ? error.message : 'Manual override failed')}`)
  }

  revalidatePath('/market')
  revalidatePath(`/market/${listingId}`)
  redirect(`/market/${listingId}?saved=override`)
}

export async function ignoreMarketListingAction(formData: FormData) {
  const listingId = String(formData.get('listing_id') || '').trim()
  const reasonRaw = String(formData.get('ignore_reason') || 'other')
  const reason = ['bad_area', 'wrong_asset_type', 'duplicate', 'already_reviewed', 'unrealistic_price', 'not_investment_suitable', 'other'].includes(reasonRaw) ? reasonRaw : 'other'
  const notes = text(formData, 'ignore_notes')
  if (!listingId) redirect('/market?error=Missing listing id')

  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  const supabase = await createSupabaseServerClient()

  try {
    const listing = await loadWorkspaceMarketListing(supabase, listingId, workspace.organization.id)
    const { error: ignoredInsertError } = await supabase.from('market_ignored_listings').upsert({
      organization_id: workspace.organization.id,
      source_type: listing.source_type,
      source_url: listing.source_url,
      external_listing_id: listing.external_listing_id,
      normalized_address: [listing.address, listing.city, listing.state].filter(Boolean).join(', ').toLowerCase(),
      zip_code: listing.zip_code,
      reason,
      notes,
      ignored_by: workspace.user.id,
    }, { onConflict: 'organization_id,source_url' })
    if (ignoredInsertError) console.warn('Ignore-list upsert skipped:', ignoredInsertError.message)
    const { error } = await supabase
      .from('market_listings')
      .update({ status: 'archived', deal_status: 'archived', deal_stage: 'archived', archived_at: new Date().toISOString(), archived_by: workspace.user.id })
      .eq('id', listingId)
      .eq('organization_id', workspace.organization.id)
    if (error) throw new Error(error.message)
  } catch (error) {
    redirect(`/market/${listingId}?error=${encodeURIComponent(error instanceof Error ? error.message : 'Could not ignore listing')}`)
  }

  revalidatePath('/market')
  revalidatePath(`/market/${listingId}`)
  redirect(`/market/${listingId}?saved=ignored`)
}
