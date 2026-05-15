'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { canUseFeature } from '@/lib/billing/features'
import { scoreMarketListing, normalizePropertyType } from '@/lib/market/scoring'
import { runMarketSourceNow } from '@/lib/market/importRunner'
import { determineDealReviewStatus } from '@/lib/market/review'
import { recordMarketListingActivity } from '@/lib/market/activity'
import { createInAppNotification } from '@/lib/notifications'
import { runListingRentIntelligence, applyMarketRentEstimateToListing, applyHudFmrToListing, rescoreListingAfterIntelligence, buildDataQualityChecklist, buildConfidenceBreakdown } from '@/lib/market/rentIntelligenceEngine'
import {
  buildNormalizedListingKey,
  detectSourceType,
  fetchAndNormalizeMarketUrl,
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
  await supabase.from('market_listing_scores').insert({
    listing_id: listing.id,
    organization_id: organizationId,
    formula_version: 'market-score-v3',
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
  })

  const review = determineDealReviewStatus(score as any, listing)
  if (listing.id && organizationId) {
    await supabase
      .from('market_listings')
      .update({
        deal_status: review.dealStatus,
        review_reason: review.reviewReason,
        why_this_deal: review.why,
        status: ['archived', 'converted_to_deal'].includes(String(listing.status)) ? listing.status : review.listingStatus,
      })
      .eq('id', listing.id)
      .eq('organization_id', organizationId)

    await recordMarketListingActivity(supabase, {
      organizationId,
      listingId: listing.id,
      eventType: 'score_calculated',
      title: 'Score calculated',
      description: `${Math.round(score.dealScore)}/100 score · rent confidence ${Math.round(score.rentConfidenceScore)}/100`,
      metadata: { dealScore: score.dealScore, rentConfidenceScore: score.rentConfidenceScore, dealStatus: review.dealStatus },
    })

    if (review.dealStatus === 'ready') {
      await createInAppNotification(supabase, {
        organizationId,
        userId: listing.created_by || null,
        type: 'opportunity_found',
        title: 'New qualified opportunity',
        message: `${listing.title || 'A market listing'} reached ${Math.round(score.dealScore)}/100 with rent confidence ${Math.round(score.rentConfidenceScore)}/100.`,
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
        message: `${listing.title || 'A market listing'} has a promising score but rent confidence is below the Opportunity gate.`,
        relatedEntityType: 'market_listing',
        relatedEntityId: listing.id,
        actionHref: `/market/${listing.id}`,
        metadata: { dealScore: score.dealScore, rentConfidenceScore: score.rentConfidenceScore },
      })
    }
  }
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
    await insertScoreForListing(params.supabase, data as any, params.organizationId)
    await recordMarketListingActivity(params.supabase, { organizationId: params.organizationId, listingId: data.id, actorId: params.userId, eventType: 'imported', title: 'Listing updated from import', description: 'Existing market listing was updated from a controlled import.', metadata: { sourceType: payload.source_type, sourceUrl: payload.source_url } })
    return { listing: data as any, created: false }
  }

  const { data, error } = await params.supabase
    .from('market_listings')
    .insert({ ...payload, raw_payload: rawPayload })
    .select('*')
    .single()
  if (error || !data) throw new Error(error?.message || 'Could not create imported listing')
  await insertScoreForListing(params.supabase, data as any, params.organizationId)
  await recordMarketListingActivity(params.supabase, { organizationId: params.organizationId, listingId: data.id, actorId: params.userId, eventType: 'imported', title: 'Listing imported', description: 'New market listing was created from a controlled import.', metadata: { sourceType: payload.source_type, sourceUrl: payload.source_url } })
  return { listing: data as any, created: true }
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

  const inputUrl = text(formData, 'input_url')
  if (!inputUrl || !inputUrl.startsWith('http')) redirect(`/market?tab=sources&error=${encodeURIComponent('Enter a valid source URL.')}`)
  const visibility = visibilityValue(formData)
  const sourceId = text(formData, 'source_id')
  const requestedSourceType = sourceTypeValue(formData)
  const sourceType = requestedSourceType === 'manual' ? detectSourceType(inputUrl) : requestedSourceType
  const supabase = await createSupabaseServerClient()

  const { data: job, error: jobError } = await supabase.from('market_import_jobs').insert({
    organization_id: workspace.organization.id,
    source_id: sourceId,
    created_by: workspace.user.id,
    job_type: sourceType === 'manual_url' ? 'manual_url' : 'authorized_scrape',
    status: 'running',
    input_url: inputUrl,
    input_payload: { sourceType, visibility, startedFrom: 'market_import_url_action' },
    started_at: new Date().toISOString(),
  }).select('*').single()

  if (jobError || !job) redirect(`/market?tab=sources&error=${encodeURIComponent(jobError?.message || 'Could not create import job')}`)

  try {
    const normalized = await fetchAndNormalizeMarketUrl(inputUrl, String(sourceType))
    const result = await upsertNormalizedListing({
      supabase,
      listing: normalized,
      organizationId: workspace.organization.id,
      userId: workspace.user.id,
      sourceId,
      importJobId: job.id,
      visibility,
    })

    await supabase.from('market_import_jobs').update({
      status: 'completed',
      finished_at: new Date().toISOString(),
      items_found: 1,
      items_created: result.created ? 1 : 0,
      items_updated: result.created ? 0 : 1,
    }).eq('id', job.id)

    await supabase.from('audit_logs').insert({
      organization_id: workspace.organization.id,
      actor_id: workspace.user.id,
      event_type: 'market_import.url.completed',
      entity_type: 'market_import_job',
      entity_id: job.id,
      metadata: { sourceType, inputUrl, listingId: result.listing.id, created: result.created },
    })

    revalidatePath('/market')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not import listing URL'
    await supabase.from('market_import_jobs').update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      items_failed: 1,
      error_message: message,
    }).eq('id', job.id)
    redirect(`/market?tab=sources&error=${encodeURIComponent(message)}`)
  }

  redirect('/opportunities?saved=imported')
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

  redirect('/opportunities?saved=csv_imported')
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
  revalidatePath(`/market/${listingId}`)
  redirect('/opportunities?saved=rescore')
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
    last_action_at: new Date().toISOString(),
  }, { onConflict: 'organization_id,user_id,listing_id' })
  if (error) redirect(`/market?error=${encodeURIComponent(error.message)}`)
  await recordMarketListingActivity(supabase, {
    organizationId: workspace.organization.id,
    listingId,
    actorId: workspace.user.id,
    eventType: 'watchlist_saved',
    title: `Watchlist status changed to ${safeStatus.replaceAll('_', ' ')}`,
    description: 'Saved deal pipeline was updated.',
    metadata: { status: safeStatus },
  })
  revalidatePath('/market')
  revalidatePath('/saved-deals')
  revalidatePath(`/market/${listingId}`)
  redirect(`/saved-deals?status=${safeStatus}&saved=${safeStatus}`)
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
    last_action_at: new Date().toISOString(),
  }, { onConflict: 'organization_id,user_id,listing_id' })
  await supabase.from('market_listings').update({ status: 'converted_to_deal' }).eq('id', listingId)
  await recordMarketListingActivity(supabase, {
    organizationId: workspace.organization.id,
    listingId,
    actorId: workspace.user.id,
    eventType: 'converted_to_deal',
    title: 'Converted to deal',
    description: 'Market listing was converted into a full underwriting deal.',
    metadata: { dealId: deal.id },
  })
  await createInAppNotification(supabase, {
    organizationId: workspace.organization.id,
    userId: workspace.user.id,
    actorId: workspace.user.id,
    type: 'deal_status_changed',
    title: 'Listing converted to deal',
    message: `${row.title || 'Market listing'} is now available in My Deals for deeper underwriting.`,
    relatedEntityType: 'deal',
    relatedEntityId: deal.id,
    actionHref: `/deals/${deal.id}`,
    metadata: { listingId },
  })

  revalidatePath('/market')
  revalidatePath('/saved-deals')
  revalidatePath(`/market/${listingId}`)
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
  redirect('/opportunities?saved=source_run')
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
  const membershipRole = String(workspace.membership?.role || '')
  const isOrgAdmin = workspace.access.isPlatformAdmin || ['owner', 'admin'].includes(membershipRole)
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
  revalidatePath(`/market/${listingId}`)
  redirect(`${returnTo}?saved=listing_archived`)
}


export async function addMarketListingNoteAction(formData: FormData) {
  const listingId = String(formData.get('listing_id') || '').trim()
  const note = text(formData, 'note')
  const noteType = String(formData.get('note_type') || 'internal')
  const safeNoteType = ['internal', 'seller_call', 'buyer_feedback', 'underwriting', 'offer', 'risk'].includes(noteType) ? noteType : 'internal'
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
    note_type: safeNoteType,
  })
  if (error) redirect(`/market/${listingId}?error=${encodeURIComponent(error.message)}`)
  await recordMarketListingActivity(supabase, {
    organizationId: workspace.organization.id,
    listingId,
    actorId: workspace.user.id,
    eventType: 'note_added',
    title: 'Note added',
    description: note.slice(0, 180),
    metadata: { noteType: safeNoteType },
  })
  await createInAppNotification(supabase, {
    organizationId: workspace.organization.id,
    userId: workspace.user.id,
    actorId: workspace.user.id,
    type: 'deal_note_added',
    title: 'Deal note added',
    message: note.slice(0, 180),
    relatedEntityType: 'market_listing',
    relatedEntityId: listingId,
    actionHref: `/market/${listingId}`,
    metadata: { noteType: safeNoteType },
  })
  revalidatePath(`/market/${listingId}`)
  revalidatePath('/notifications')
  redirect(`/market/${listingId}?saved=note`)
}

export async function updateMarketListingReviewStatusAction(formData: FormData) {
  const listingId = String(formData.get('listing_id') || '').trim()
  const dealStatus = String(formData.get('deal_status') || 'needs_review')
  const safeDealStatus = ['ready', 'needs_review', 'missing_data', 'low_confidence', 'archived'].includes(dealStatus) ? dealStatus : 'needs_review'
  const reviewReason = text(formData, 'review_reason') || `Review status changed to ${safeDealStatus.replaceAll('_', ' ')}.`
  const returnTo = String(formData.get('return_to') || `/market/${listingId}`)
  if (!listingId) redirect('/market?error=Missing listing id')
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  const supabase = await createSupabaseServerClient()
  const listingStatus = safeDealStatus === 'ready' ? 'opportunity' : safeDealStatus === 'archived' ? 'archived' : 'needs_review'
  const { error } = await supabase
    .from('market_listings')
    .update({
      deal_status: safeDealStatus,
      status: listingStatus,
      review_reason: reviewReason,
      last_reviewed_at: new Date().toISOString(),
      last_reviewed_by: workspace.user.id,
    })
    .eq('id', listingId)
    .eq('organization_id', workspace.organization.id)
  if (error) redirect(`/market/${listingId}?error=${encodeURIComponent(error.message)}`)
  await recordMarketListingActivity(supabase, {
    organizationId: workspace.organization.id,
    listingId,
    actorId: workspace.user.id,
    eventType: safeDealStatus === 'ready' ? 'marked_opportunity' : 'review_updated',
    title: `Review status: ${safeDealStatus.replaceAll('_', ' ')}`,
    description: reviewReason,
    metadata: { dealStatus: safeDealStatus, listingStatus },
  })
  await createInAppNotification(supabase, {
    organizationId: workspace.organization.id,
    userId: workspace.user.id,
    actorId: workspace.user.id,
    type: 'deal_status_changed',
    title: 'Deal review status updated',
    message: reviewReason,
    relatedEntityType: 'market_listing',
    relatedEntityId: listingId,
    actionHref: `/market/${listingId}`,
    metadata: { dealStatus: safeDealStatus, listingStatus },
  })
  revalidatePath('/market')
  revalidatePath('/opportunities')
  revalidatePath('/saved-deals')
  revalidatePath(`/market/${listingId}`)
  redirect(returnTo.startsWith('/') ? `${returnTo}${returnTo.includes('?') ? '&' : '?'}saved=review` : `/market/${listingId}?saved=review`)
}


async function loadOrgListing(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, listingId: string, organizationId: string) {
  const { data, error } = await supabase.from('market_listings').select('*').eq('id', listingId).eq('organization_id', organizationId).maybeSingle()
  if (error || !data) throw new Error(error?.message || 'Listing not found')
  return data as Record<string, any>
}

export async function runListingMarketRentAction(formData: FormData) {
  const listingId = String(formData.get('listing_id') || '').trim()
  if (!listingId) redirect('/market?error=Missing listing id')
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  const supabase = await createSupabaseServerClient()
  try {
    const listing = await loadOrgListing(supabase, listingId, workspace.organization.id)
    const result = await applyMarketRentEstimateToListing({ supabase, organizationId: workspace.organization.id, userId: workspace.user.id, listing, source: 'manual_button' })
    const score = await rescoreListingAfterIntelligence({ supabase, organizationId: workspace.organization.id, userId: workspace.user.id, listing: result.listing })
    await supabase.from('market_listings').update({ data_quality_checklist: buildDataQualityChecklist(result.listing, score), confidence_breakdown: buildConfidenceBreakdown(result.listing, score) }).eq('id', listingId).eq('organization_id', workspace.organization.id)
  } catch (error) {
    redirect(`/market/${listingId}?error=${encodeURIComponent(error instanceof Error ? error.message : 'Market rent analysis failed')}`)
  }
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
    const listing = await loadOrgListing(supabase, listingId, workspace.organization.id)
    const result = await applyHudFmrToListing({ supabase, organizationId: workspace.organization.id, userId: workspace.user.id, listing, hudYear: 'auto' })
    const score = await rescoreListingAfterIntelligence({ supabase, organizationId: workspace.organization.id, userId: workspace.user.id, listing: result.listing })
    await supabase.from('market_listings').update({ data_quality_checklist: buildDataQualityChecklist(result.listing, score), confidence_breakdown: buildConfidenceBreakdown(result.listing, score) }).eq('id', listingId).eq('organization_id', workspace.organization.id)
  } catch (error) {
    await createInAppNotification(supabase, { organizationId: workspace.organization.id, userId: workspace.user.id, actorId: workspace.user.id, type: 'hud_lookup_failed', title: 'HUD/FMR lookup failed', message: error instanceof Error ? error.message : 'HUD lookup failed', relatedEntityType: 'market_listing', relatedEntityId: listingId, actionHref: `/market/${listingId}` })
    redirect(`/market/${listingId}?error=${encodeURIComponent(error instanceof Error ? error.message : 'HUD lookup failed')}`)
  }
  revalidatePath(`/market/${listingId}`)
  redirect(`/market/${listingId}?saved=hud`)
}

export async function runListingFullIntelligenceAction(formData: FormData) {
  const listingId = String(formData.get('listing_id') || '').trim()
  if (!listingId) redirect('/market?error=Missing listing id')
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  const supabase = await createSupabaseServerClient()
  try {
    const listing = await loadOrgListing(supabase, listingId, workspace.organization.id)
    await runListingRentIntelligence({ supabase, organizationId: workspace.organization.id, userId: workspace.user.id, listing, runHud: true })
  } catch (error) {
    redirect(`/market/${listingId}?error=${encodeURIComponent(error instanceof Error ? error.message : 'Rent intelligence failed')}`)
  }
  revalidatePath(`/market/${listingId}`)
  redirect(`/market/${listingId}?saved=intelligence`)
}

export async function addListingManualOverrideAction(formData: FormData) {
  const listingId = String(formData.get('listing_id') || '').trim()
  const fieldName = String(formData.get('field_name') || 'market_rent').trim()
  const newValue = String(formData.get('new_value') || '').trim()
  const reason = text(formData, 'reason') || 'Manual underwriting override.'
  const applyToScore = String(formData.get('apply_to_score') || 'on') === 'on'
  if (!listingId || !newValue) redirect(`/market/${listingId || ''}?error=${encodeURIComponent('Manual override needs a value.')}`)
  const safeField = ['market_rent', 'hud_rent', 'current_rent', 'list_price', 'asking_price', 'rehab_estimate', 'taxes_annual', 'insurance_annual'].includes(fieldName) ? fieldName : 'market_rent'
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  const supabase = await createSupabaseServerClient()
  try {
    const listing = await loadOrgListing(supabase, listingId, workspace.organization.id)
    const oldValue = listing[safeField] == null ? null : String(listing[safeField])
    await supabase.from('listing_manual_overrides').insert({ organization_id: workspace.organization.id, listing_id: listingId, field_name: safeField, old_value: oldValue, new_value: newValue, reason, apply_to_score: applyToScore, created_by: workspace.user.id })
    await supabase.from('market_listings').update({ [safeField]: Number(newValue.replace(/[$,\s]/g, '')), review_reason: `Manual override applied to ${safeField}: ${reason}` }).eq('id', listingId).eq('organization_id', workspace.organization.id)
    await recordMarketListingActivity(supabase, { organizationId: workspace.organization.id, listingId, actorId: workspace.user.id, eventType: 'manual_override_added', title: 'Manual override added', description: `${safeField} changed from ${oldValue || 'blank'} to ${newValue}. ${reason}`, metadata: { fieldName: safeField, oldValue, newValue, applyToScore } })
    await createInAppNotification(supabase, { organizationId: workspace.organization.id, userId: workspace.user.id, actorId: workspace.user.id, type: 'manual_override_changed', title: 'Manual override changed score inputs', message: `${safeField} changed to ${newValue}.`, relatedEntityType: 'market_listing', relatedEntityId: listingId, actionHref: `/market/${listingId}`, metadata: { fieldName: safeField, oldValue, newValue } })
    if (applyToScore) {
      const refreshed = await loadOrgListing(supabase, listingId, workspace.organization.id)
      const score = await rescoreListingAfterIntelligence({ supabase, organizationId: workspace.organization.id, userId: workspace.user.id, listing: refreshed })
      await supabase.from('market_listings').update({ data_quality_checklist: buildDataQualityChecklist(refreshed, score), confidence_breakdown: buildConfidenceBreakdown(refreshed, score) }).eq('id', listingId).eq('organization_id', workspace.organization.id)
    }
  } catch (error) {
    redirect(`/market/${listingId}?error=${encodeURIComponent(error instanceof Error ? error.message : 'Manual override failed')}`)
  }
  revalidatePath(`/market/${listingId}`)
  redirect(`/market/${listingId}?saved=override`)
}

export async function updateMarketListingStageAction(formData: FormData) {
  const listingId = String(formData.get('listing_id') || '').trim()
  const stage = String(formData.get('deal_stage') || 'needs_review')
  const safeStage = ['imported','needs_review','analyzed','watchlist','opportunity','underwriting','offer_made','rejected','archived'].includes(stage) ? stage : 'needs_review'
  if (!listingId) redirect('/market?error=Missing listing id')
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.from('market_listings').update({ deal_stage: safeStage }).eq('id', listingId).eq('organization_id', workspace.organization.id)
  if (error) redirect(`/market/${listingId}?error=${encodeURIComponent(error.message)}`)
  await recordMarketListingActivity(supabase, { organizationId: workspace.organization.id, listingId, actorId: workspace.user.id, eventType: 'stage_updated', title: `Stage: ${safeStage.replaceAll('_', ' ')}`, metadata: { dealStage: safeStage } })
  revalidatePath(`/market/${listingId}`)
  redirect(`/market/${listingId}?saved=stage`)
}

export async function ignoreMarketListingAction(formData: FormData) {
  const listingId = String(formData.get('listing_id') || '').trim()
  const reasonRaw = String(formData.get('ignore_reason') || 'other')
  const reason = ['bad_area','wrong_asset_type','duplicate','already_reviewed','unrealistic_price','not_investment_suitable','other'].includes(reasonRaw) ? reasonRaw : 'other'
  const notes = text(formData, 'ignore_notes')
  if (!listingId) redirect('/market?error=Missing listing id')
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  const supabase = await createSupabaseServerClient()
  try {
    const listing = await loadOrgListing(supabase, listingId, workspace.organization.id)
    await supabase.from('market_ignored_listings').upsert({ organization_id: workspace.organization.id, source_type: listing.source_type, source_url: listing.source_url, external_listing_id: listing.external_listing_id, normalized_address: [listing.address, listing.city, listing.state].filter(Boolean).join(', ').toLowerCase(), zip_code: listing.zip_code, reason, notes, ignored_by: workspace.user.id }, { onConflict: 'organization_id,source_url' })
    await supabase.from('market_listings').update({ status: 'archived', deal_status: 'archived', deal_stage: 'archived', archived_at: new Date().toISOString(), archived_by: workspace.user.id }).eq('id', listingId).eq('organization_id', workspace.organization.id)
    await recordMarketListingActivity(supabase, { organizationId: workspace.organization.id, listingId, actorId: workspace.user.id, eventType: 'ignored', title: 'Listing ignored', description: reason.replaceAll('_', ' '), metadata: { reason, notes } })
  } catch (error) {
    redirect(`/market/${listingId}?error=${encodeURIComponent(error instanceof Error ? error.message : 'Could not ignore listing')}`)
  }
  revalidatePath('/market')
  revalidatePath(`/market/${listingId}`)
  redirect(`/market/${listingId}?saved=ignored`)
}
