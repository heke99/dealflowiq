'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { assertNotPaymentRequired } from '@/lib/auth/access'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { canUseFeature } from '@/lib/billing/features'
import { normalizePropertyType } from '@/lib/market/scoring'
import { runMarketSourceNow, upsertMarketListingFromNormalized } from '@/lib/market/importRunner'
import { countRecentProviderImports, ensurePlanImportQuota, importPolicyForSource } from '@/lib/market/importGuards'
import { recordImportAuditEvent } from '@/lib/market/importAudit'
import { recordMarketListingActivity } from '@/lib/market/activity'
import { createInAppNotification } from '@/lib/notifications'
import { recordAuditEvent } from '@/lib/audit'
import { listingToDealPayload } from '@/lib/deals/convertListing'
import { dealToMarketListingPayload } from '@/lib/deals/publishDeal'
import { type Row } from '@/lib/types/rows'
import { runListingRentIntelligence, applyMarketRentEstimateToListing, applyHudFmrToListing, rescoreListingAfterIntelligence, buildDataQualityChecklist, buildConfidenceBreakdown } from '@/lib/market/rentIntelligenceEngine'
import {
  buildUrlOnlyMarketListing,
  detectSourceType,
  discoverListingUrlsFromSearchUrl,
  fetchAndNormalizeMarketUrl,
  isSearchResultsUrl,
  parseMarketCsvText,
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

function requireSourceImports(workspace: Awaited<ReturnType<typeof getCurrentWorkspace>>) {
  if (!canUseFeature(workspace.access.features, 'market_source_imports')) {
    redirect(`/imports?error=${encodeURIComponent('Source imports are a premium feature. Upgrade to import URLs, CSV feeds and external market sources.')}`)
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
  if (error || !source) redirect(`/imports?error=${encodeURIComponent(error?.message || 'Could not create source')}`)

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
  redirect('/imports?saved=source')
}

export async function importMarketUrlAction(formData: FormData) {
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  assertNotPaymentRequired(workspace)
  requireSourceImports(workspace)

  const inputUrl = text(formData, 'input_url')
  if (!inputUrl || !inputUrl.startsWith('http')) redirect(`/imports?error=${encodeURIComponent('Enter a valid source URL.')}`)
  const visibility = visibilityValue(formData)
  const sourceId = text(formData, 'source_id')
  const requestedSourceType = sourceTypeValue(formData)
  const sourceType = requestedSourceType === 'manual' || requestedSourceType === 'manual_url' ? detectSourceType(inputUrl) : requestedSourceType
  const supabase = await createSupabaseServerClient()
  const searchImport = isSearchResultsUrl(inputUrl)

  // Provider policy, rolling-hour rate limit and plan quota gates (mirrors
  // analyzeImportUrlAction in app/imports/actions.ts).
  const policy = await importPolicyForSource(supabase, workspace.organization.id, String(sourceType))
  if (!policy.active) redirect(`/imports?error=${encodeURIComponent(`${policy.label} import is not active. Configure provider policy before live import.`)}`)
  if (searchImport && !policy.searchImportAllowed) redirect(`/imports?error=${encodeURIComponent(`${policy.label} search import is not allowed by current provider policy.`)}`)
  if (!searchImport && !policy.listingImportAllowed) redirect(`/imports?error=${encodeURIComponent(`${policy.label} listing import is not allowed by current provider policy.`)}`)

  const recent = await countRecentProviderImports(supabase, workspace.organization.id, String(sourceType))
  const remaining = Math.max(0, policy.maxListingsPerHour - recent)
  if (remaining <= 0) redirect(`/imports?error=${encodeURIComponent(`${policy.label} rate limit reached. Try again after the rolling hour window.`)}`)
  const maxUrlsThisRun = Math.min(remaining, 10)

  try {
    await ensurePlanImportQuota({ supabase, workspace, requested: searchImport ? maxUrlsThisRun : 1 })
  } catch (quotaError) {
    redirect(`/imports?error=${encodeURIComponent(quotaError instanceof Error ? quotaError.message : 'Import limit reached')}`)
  }

  const { data: job, error: jobError } = await supabase.from('market_import_jobs').insert({
    organization_id: workspace.organization.id,
    source_id: sourceId,
    created_by: workspace.user.id,
    job_type: 'authorized_scrape',
    status: 'running',
    input_url: inputUrl,
    input_payload: { sourceType, visibility, startedFrom: 'market_import_url_action', searchImport, importMode: searchImport ? 'search_url' : 'listing_url' },
    started_at: new Date().toISOString(),
  }).select('*').single()

  if (jobError || !job) redirect(`/imports?error=${encodeURIComponent(jobError?.message || 'Could not create import job')}`)

  const previewRows: Record<string, unknown>[] = []
  const listingIds: string[] = []
  let created = 0
  let updated = 0
  let failed = 0
  let found = 0
  let topScore = 0

  try {
    const discovered = searchImport
      ? await discoverListingUrlsFromSearchUrl(inputUrl, String(sourceType), maxUrlsThisRun)
      : [{ url: inputUrl, sourceType, sourceUrl: inputUrl, order: 1 }]
    found = discovered.length
    if (!discovered.length) throw new Error('No eligible listing URLs were found on the source page.')

    const expiresAt = new Date(Date.now() + policy.storageDays * 24 * 60 * 60 * 1000).toISOString()

    for (const entry of discovered.slice(0, maxUrlsThisRun)) {
      const listingUrl = typeof entry === 'string' ? entry : String(entry.url || '').trim()
      const entrySourceType = typeof entry === 'string' ? String(sourceType) : String(entry.sourceType || sourceType)
      if (!listingUrl) continue
      try {
        const normalized = await fetchAndNormalizeMarketUrl(listingUrl, entrySourceType)
        ;(normalized as Row).source_data_expires_at = expiresAt
        ;(normalized as Row).provider_data_expires_at = expiresAt
        const result = await upsertMarketListingFromNormalized({
          supabase,
          listing: normalized,
          organizationId: workspace.organization.id,
          userId: workspace.user.id,
          sourceId,
          importJobId: job.id,
          visibility,
        })
        listingIds.push(String(result.listing.id))
        if (result.created) created += 1
        else updated += 1
        const score = Number(result.score.dealScore || 0)
        topScore = Math.max(topScore, score)
        await recordImportAuditEvent(supabase, {
          organizationId: workspace.organization.id,
          userId: workspace.user.id,
          listingId: String(result.listing.id),
          eventType: 'listing_imported',
          message: result.created ? 'Listing imported from URL.' : 'Listing updated from URL import.',
          metadata: { sourceType: entrySourceType, sourceUrl: listingUrl, jobId: job.id },
        })
        previewRows.push({
          status: result.created ? 'created' : 'updated',
          listing_id: result.listing.id,
          source_url: listingUrl,
          address: result.listing.address || result.listing.title,
          city: result.listing.city,
          state: result.listing.state,
          zip_code: result.listing.zip_code,
          list_price: result.listing.list_price || result.listing.asking_price,
          bedrooms: result.listing.bedrooms,
          bathrooms: result.listing.bathrooms,
          sqft: result.listing.sqft,
          score,
        })
      } catch (rowError) {
        const message = rowError instanceof Error ? rowError.message : 'Import failed'
        // Fetch/parse failed: keep the URL as a review-required listing through
        // the canonical upsert instead of dropping the row entirely.
        try {
          const fallback = buildUrlOnlyMarketListing(listingUrl, entrySourceType, message)
          ;(fallback as unknown as Row).source_data_expires_at = expiresAt
          ;(fallback as unknown as Row).provider_data_expires_at = expiresAt
          const fallbackResult = await upsertMarketListingFromNormalized({
            supabase,
            listing: fallback,
            organizationId: workspace.organization.id,
            userId: workspace.user.id,
            sourceId,
            importJobId: job.id,
            visibility,
          })
          listingIds.push(String(fallbackResult.listing.id))
          if (fallbackResult.created) created += 1
          else updated += 1
          await recordImportAuditEvent(supabase, {
            organizationId: workspace.organization.id,
            userId: workspace.user.id,
            listingId: String(fallbackResult.listing.id),
            eventType: 'listing_imported',
            message: 'URL-only review listing imported after source fetch failed.',
            metadata: { sourceType: entrySourceType, sourceUrl: listingUrl, jobId: job.id, fallbackReason: message },
          })
          previewRows.push({
            status: 'review_required',
            listing_id: fallbackResult.listing.id,
            source_url: listingUrl,
            address: fallbackResult.listing.address || fallbackResult.listing.title,
            error: message,
            score: Number(fallbackResult.score.dealScore || 0),
          })
        } catch (fallbackError) {
          failed += 1
          previewRows.push({ status: 'failed', source_url: listingUrl, error: fallbackError instanceof Error ? fallbackError.message : message })
        }
      }
    }

    // 'partial' is the value allowed by the market_import_jobs status CHECK.
    const finalStatus = failed && (created + updated) ? 'partial' : failed ? 'failed' : 'completed'
    const { error: jobUpdateError } = await supabase.from('market_import_jobs').update({
      status: finalStatus,
      finished_at: new Date().toISOString(),
      items_found: found,
      items_created: created,
      items_updated: updated,
      items_failed: failed,
      normalized_listing_ids: listingIds,
      source_summary: { previewRows, topScore, searchImport, sourceType, message: `${created} created · ${updated} updated · ${failed} failed.` },
      error_message: finalStatus === 'failed' ? 'All listing imports failed. Open job details for row errors.' : null,
    }).eq('id', job.id)
    if (jobUpdateError) throw new Error(jobUpdateError.message)

    await supabase.from('audit_logs').insert({
      organization_id: workspace.organization.id,
      actor_id: workspace.user.id,
      event_type: 'market_import.url.completed',
      entity_type: 'market_import_job',
      entity_id: job.id,
      metadata: { sourceType, inputUrl, listingIds, created, updated, failed, found, topScore, searchImport },
    })

    revalidatePath('/market')
    revalidatePath('/imports')
    revalidatePath('/opportunities')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not import URL'
    await supabase.from('market_import_jobs').update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      items_found: found,
      items_created: created,
      items_updated: updated,
      items_failed: Math.max(failed, 1),
      normalized_listing_ids: listingIds,
      source_summary: { previewRows, topScore, searchImport, sourceType },
      error_message: message,
    }).eq('id', job.id)
    redirect(`/imports?import_job_id=${job.id}&error=${encodeURIComponent(message)}`)
  }

  redirect(`/market?tab=all&import_job_id=${job.id}&saved=imported`)
}

export async function importMarketCsvAction(formData: FormData) {
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  assertNotPaymentRequired(workspace)
  requireSourceImports(workspace)

  const rawCsv = String(formData.get('csv_text') || '').trim()
  if (!rawCsv) redirect(`/imports?error=${encodeURIComponent('Paste CSV text first.')}`)
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
  if (jobError || !job) redirect(`/imports?error=${encodeURIComponent(jobError?.message || 'Could not create CSV import job')}`)

  try {
    const listings = parseMarketCsvText(rawCsv, 'csv')
    if (!listings.length) throw new Error('No valid CSV rows found. Include a header row, for example: title,address,city,state,zip,list_price,market_rent,primary_image_url')
    await ensurePlanImportQuota({ supabase, workspace, requested: Math.min(listings.length, 100) })
    let created = 0
    let updated = 0
    let failed = 0
    for (const listing of listings.slice(0, 100)) {
      try {
        const result = await upsertMarketListingFromNormalized({
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
        await recordImportAuditEvent(supabase, {
          organizationId: workspace.organization.id,
          userId: workspace.user.id,
          listingId: String(result.listing.id),
          eventType: 'listing_imported',
          message: result.created ? 'Listing imported from CSV.' : 'Listing updated from CSV import.',
          metadata: { sourceType: String(listing.source_type || 'csv'), sourceUrl: listing.source_url || null, jobId: job.id },
        })
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
    redirect(`/imports?error=${encodeURIComponent(message)}`)
  }

  redirect('/opportunities?saved=csv_imported')
}

export async function createMarketListingAction(formData: FormData) {
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  assertNotPaymentRequired(workspace)

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
    const result = await upsertMarketListingFromNormalized({
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
    redirect(`/imports?error=${encodeURIComponent(message)}`)
  }

  redirect('/market?tab=all&saved=listing')
}

export async function rescoreMarketListingAction(formData: FormData) {
  const listingId = String(formData.get('listing_id') || '').trim()
  if (!listingId) redirect('/market?error=Missing listing id')
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  const supabase = await createSupabaseServerClient()
  try {
    await rescoreAndSyncListing({ supabase, organizationId: workspace.organization.id, userId: workspace.user.id, listingId })
  } catch (error) {
    redirect(`/market/${listingId}?error=${encodeURIComponent(error instanceof Error ? error.message : 'Rescore failed')}`)
  }
  revalidatePath('/market')
  revalidatePath('/opportunities')
  revalidatePath(`/market/${listingId}`)
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

  // Plan limit: max_saved_deals caps new watchlist entries (updates to
  // already-saved listings are always allowed).
  const savedDealsLimit = workspace.access.limits.max_saved_deals
  if (savedDealsLimit !== null && savedDealsLimit !== undefined && !workspace.access.isPlatformAdmin) {
    const [{ data: existingEntry }, { count: savedCount }] = await Promise.all([
      supabase
        .from('market_watchlist')
        .select('id')
        .eq('organization_id', workspace.organization.id)
        .eq('user_id', workspace.user.id)
        .eq('listing_id', listingId)
        .maybeSingle(),
      supabase
        .from('market_watchlist')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', workspace.organization.id)
        .eq('user_id', workspace.user.id)
        .not('status', 'in', '(ignored,passed)'),
    ])
    if (!existingEntry && Number(savedCount || 0) >= Number(savedDealsLimit)) {
      redirect(`/saved-deals?error=${encodeURIComponent(`Your plan allows ${savedDealsLimit} saved deals. Upgrade to save more.`)}`)
    }
  }

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

  const row = listing as Row
  // Explicit tenancy check on top of RLS: convert is allowed for listings in
  // the caller's own organization or listings explicitly shared cross-org.
  const belongsToOrg = row.organization_id === workspace.organization.id
  const isSharedListing = ['public', 'community'].includes(String(row.visibility || ''))
  if (!belongsToOrg && !isSharedListing && !workspace.access.isPlatformAdmin) {
    redirect('/market?error=You do not have access to convert this listing')
  }
  const { data: deal, error: dealError } = await supabase.from('deals').insert(
    listingToDealPayload(row, { organizationId: workspace.organization.id, userId: workspace.user.id })
  ).select('id').single()
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
  // Only mutate the listing status for listings the caller's org owns —
  // shared public/community listings from other orgs must stay untouched.
  if (belongsToOrg) {
    await supabase.from('market_listings').update({ status: 'converted_to_deal' }).eq('id', listingId).eq('organization_id', workspace.organization.id)
  }
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
  if (!sourceId) redirect('/imports?error=Missing source id')

  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  if (!canUseFeature(workspace.access.features, 'scheduled_market_imports') && !workspace.access.isPlatformAdmin) {
    redirect(`/imports?error=${encodeURIComponent('Scheduled/source runs are a premium feature.')}`)
  }

  const supabase = await createSupabaseServerClient()
  const { data: source, error } = await supabase
    .from('market_sources')
    .select('*')
    .eq('id', sourceId)
    .eq('organization_id', workspace.organization.id)
    .maybeSingle()
  if (error || !source) redirect(`/imports?error=${encodeURIComponent(error?.message || 'Source not found')}`)

  try {
    await runMarketSourceNow(source, { maxUrls: 5 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not run market source'
    redirect(`/imports?error=${encodeURIComponent(message)}`)
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
  assertNotPaymentRequired(workspace)
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
  const dealRow = deal as Row

  const publishedAt = new Date().toISOString()
  const { error: updateError } = await supabase.from('deals').update({
    visibility,
    published_at: publishedAt,
    expires_at: text(formData, 'expires_at'),
  }).eq('id', dealId).eq('organization_id', workspace.organization.id)
  if (updateError) redirect(`/deals/${dealId}?error=${encodeURIComponent(updateError.message)}`)

  const title = text(formData, 'title') || dealRow.title
  const postPayload = {
    deal_id: dealId,
    organization_id: workspace.organization.id,
    created_by: workspace.user.id,
    visibility,
    community_id: text(formData, 'community_id'),
    title,
    summary: text(formData, 'summary') || dealRow.notes,
    asking_price: numberValue(formData, 'asking_price') || dealRow.asking_price || dealRow.purchase_price,
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

  const listingPayload = dealToMarketListingPayload(dealRow, {
    visibility,
    dealId,
    publishedAt,
    title,
    summary: text(formData, 'summary'),
    askingPrice: numberValue(formData, 'asking_price'),
    contactEmail: text(formData, 'contact_email'),
  })

  try {
    await upsertMarketListingFromNormalized({
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

export async function unpublishDealAction(formData: FormData) {
  const dealId = String(formData.get('deal_id') || '').trim()
  if (!dealId) redirect('/deals?error=Missing deal id')
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  const supabase = await createSupabaseServerClient()

  const { data: deal, error: dealError } = await supabase
    .from('deals')
    .select('id, title, visibility, published_at')
    .eq('id', dealId)
    .eq('organization_id', workspace.organization.id)
    .maybeSingle()
  if (dealError || !deal) redirect(`/deals/${dealId}?error=${encodeURIComponent(dealError?.message || 'Deal not found')}`)
  const dealRow = deal as Row

  const { error: updateError } = await supabase
    .from('deals')
    .update({ visibility: 'private', published_at: null })
    .eq('id', dealId)
    .eq('organization_id', workspace.organization.id)
  if (updateError) redirect(`/deals/${dealId}?error=${encodeURIComponent(updateError.message)}`)

  const { error: postError } = await supabase
    .from('public_deal_posts')
    .update({ status: 'archived' })
    .eq('deal_id', dealId)
    .eq('organization_id', workspace.organization.id)
  if (postError) redirect(`/deals/${dealId}?error=${encodeURIComponent(postError.message)}`)

  // Archive the Market listing(s) publishDealToMarketAction created. That
  // action stores the deal id in both raw_payload.dealId and
  // external_listing_id (for community_deal/public_deal source types), so
  // match on either linkage.
  const archivePatch = { status: 'archived', archived_at: new Date().toISOString(), archived_by: workspace.user.id }
  const { error: rawPayloadArchiveError } = await supabase
    .from('market_listings')
    .update(archivePatch)
    .eq('organization_id', workspace.organization.id)
    .eq('raw_payload->>dealId', dealId)
  if (rawPayloadArchiveError) redirect(`/deals/${dealId}?error=${encodeURIComponent(rawPayloadArchiveError.message)}`)

  const { error: sourceLinkArchiveError } = await supabase
    .from('market_listings')
    .update(archivePatch)
    .eq('organization_id', workspace.organization.id)
    .eq('external_listing_id', dealId)
    .in('source_type', ['community_deal', 'public_deal'])
  if (sourceLinkArchiveError) redirect(`/deals/${dealId}?error=${encodeURIComponent(sourceLinkArchiveError.message)}`)

  await recordAuditEvent({
    organizationId: workspace.organization.id,
    actorId: workspace.user.id,
    eventType: 'deal.unpublished',
    entityType: 'deal',
    entityId: dealId,
    metadata: { title: dealRow.title, previous_visibility: dealRow.visibility },
  })

  revalidatePath('/market')
  revalidatePath('/deals')
  revalidatePath(`/deals/${dealId}`)
  redirect(`/deals/${dealId}?saved=unpublished`)
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

  const row = listing as Row
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
  return data as Row
}


const ANALYSIS_NUMERIC_FIELDS = [
  'list_price',
  'asking_price',
  'arv',
  'rehab_estimate',
  'current_rent',
  'market_rent',
  'estimated_rent',
  'target_rent',
  'hud_rent',
  'taxes_annual',
  'insurance_annual',
  'hoa_monthly',
  'utilities_monthly',
  'capex_monthly',
  'vacancy_percent',
  'management_percent',
  'down_payment_percent',
  'interest_rate_percent',
  'loan_term_months',
  'dscr_min_threshold',
] as const

function numericPatchFromFormData(formData: FormData) {
  const patch: Record<string, number | null> = {}
  for (const field of ANALYSIS_NUMERIC_FIELDS) {
    if (!formData.has(field)) continue
    const raw = String(formData.get(field) || '').trim()
    patch[field] = raw ? numberValue(formData, field) : null
  }
  if (patch.market_rent != null && patch.estimated_rent == null) patch.estimated_rent = patch.market_rent
  return patch
}

async function rescoreAndSyncListing(params: { supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>; organizationId: string; userId?: string | null; listingId: string }) {
  const listing = await loadOrgListing(params.supabase, params.listingId, params.organizationId)
  const score = await rescoreListingAfterIntelligence({ supabase: params.supabase, organizationId: params.organizationId, userId: params.userId || null, listing })
  const refreshed = await loadOrgListing(params.supabase, params.listingId, params.organizationId)
  await params.supabase
    .from('market_listings')
    .update({
      data_quality_checklist: buildDataQualityChecklist(refreshed, score),
      confidence_breakdown: buildConfidenceBreakdown(refreshed, score),
      analysis_last_saved_at: new Date().toISOString(),
      analysis_last_saved_by: params.userId || null,
    })
    .eq('id', params.listingId)
    .eq('organization_id', params.organizationId)
  return { listing: refreshed, score }
}

export async function updateMarketListingAnalysisInputsAction(formData: FormData) {
  const listingId = String(formData.get('listing_id') || '').trim()
  if (!listingId) redirect('/market?error=Missing listing id')
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  const supabase = await createSupabaseServerClient()
  try {
    const patch = numericPatchFromFormData(formData)
    if (!Object.keys(patch).length) throw new Error('No analysis inputs were submitted.')
    const { error } = await supabase
      .from('market_listings')
      .update({
        ...patch,
        review_reason: 'Analysis inputs were manually updated and score was recalculated.',
        analysis_last_saved_at: new Date().toISOString(),
        analysis_last_saved_by: workspace.user.id,
      })
      .eq('id', listingId)
      .eq('organization_id', workspace.organization.id)
    if (error) throw new Error(error.message)

    const { listing, score } = await rescoreAndSyncListing({ supabase, organizationId: workspace.organization.id, userId: workspace.user.id, listingId })
    await recordMarketListingActivity(supabase, {
      organizationId: workspace.organization.id,
      listingId,
      actorId: workspace.user.id,
      eventType: 'analysis_inputs_updated',
      title: 'Analysis inputs updated',
      description: `Inputs saved. Score is now ${Math.round(Number(score.dealScore || 0))}/100 and rent confidence is ${Math.round(Number(score.rentConfidenceScore || 0))}/100.`,
      metadata: { changedFields: Object.keys(patch), score, listingId: listing.id },
    })
  } catch (error) {
    redirect(`/market/${listingId}?error=${encodeURIComponent(error instanceof Error ? error.message : 'Analysis inputs failed to save')}`)
  }
  revalidatePath('/market')
  revalidatePath('/opportunities')
  revalidatePath(`/market/${listingId}`)
  redirect(`/market/${listingId}?saved=analysis_inputs`)
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
  const parsedOverrideValue = Number(newValue.replace(/[$,\s]/g, ''))
  if (!Number.isFinite(parsedOverrideValue) || parsedOverrideValue < 0) redirect(`/market/${listingId}?error=${encodeURIComponent('Manual override value must be a valid positive number.')}`)
  const safeField = ['market_rent', 'hud_rent', 'current_rent', 'estimated_rent', 'target_rent', 'list_price', 'asking_price', 'arv', 'rehab_estimate', 'taxes_annual', 'insurance_annual', 'hoa_monthly', 'utilities_monthly', 'capex_monthly', 'vacancy_percent', 'management_percent', 'down_payment_percent', 'interest_rate_percent', 'loan_term_months', 'dscr_min_threshold'].includes(fieldName) ? fieldName : 'market_rent'
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  const supabase = await createSupabaseServerClient()
  try {
    const listing = await loadOrgListing(supabase, listingId, workspace.organization.id)
    const oldValue = listing[safeField] == null ? null : String(listing[safeField])
    const { error: overrideError } = await supabase.from('listing_manual_overrides').insert({ organization_id: workspace.organization.id, listing_id: listingId, field_name: safeField, old_value: oldValue, new_value: String(parsedOverrideValue), reason, apply_to_score: applyToScore, created_by: workspace.user.id })
    if (overrideError) throw new Error(`Manual override history failed: ${overrideError.message}`)
    const listingUpdate: Record<string, unknown> = { [safeField]: parsedOverrideValue, review_reason: `Manual override applied to ${safeField}: ${reason}` }
    if (safeField === 'market_rent') listingUpdate.estimated_rent = parsedOverrideValue
    const { data: updatedListing, error: listingUpdateError } = await supabase.from('market_listings').update(listingUpdate).eq('id', listingId).eq('organization_id', workspace.organization.id).select('*').single()
    if (listingUpdateError || !updatedListing) throw new Error(listingUpdateError?.message || 'Manual override did not update the listing.')
    await recordMarketListingActivity(supabase, { organizationId: workspace.organization.id, listingId, actorId: workspace.user.id, eventType: 'manual_override_added', title: 'Manual override added', description: `${safeField} changed from ${oldValue || 'blank'} to ${newValue}. ${reason}`, metadata: { fieldName: safeField, oldValue, newValue: parsedOverrideValue, applyToScore } })
    await createInAppNotification(supabase, { organizationId: workspace.organization.id, userId: workspace.user.id, actorId: workspace.user.id, type: 'manual_override_changed', title: 'Manual override changed score inputs', message: `${safeField} changed to ${parsedOverrideValue}.`, relatedEntityType: 'market_listing', relatedEntityId: listingId, actionHref: `/market/${listingId}`, metadata: { fieldName: safeField, oldValue, newValue: parsedOverrideValue } })
    if (applyToScore) {
      await rescoreAndSyncListing({ supabase, organizationId: workspace.organization.id, userId: workspace.user.id, listingId })
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
