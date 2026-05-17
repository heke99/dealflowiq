'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { canUseFeature } from '@/lib/billing/features'
import { analyzeMarketUrl } from '@/lib/market/urlAnalyzer'
import { createInAppNotification } from '@/lib/notifications'
import { discoverListingUrlsFromSearchUrl, fetchAndNormalizeMarketUrl } from '@/lib/market/sourceConnectors'
import { upsertMarketListingFromNormalized } from '@/lib/market/importRunner'
import { runListingRentIntelligence, buildDataQualityChecklist, buildConfidenceBreakdown } from '@/lib/market/rentIntelligenceEngine'
import { providerPolicyFromRow, providerPolicySnapshot } from '@/lib/market/providerPolicies'

type SupabaseServer = Awaited<ReturnType<typeof createSupabaseServerClient>>
type Workspace = Awaited<ReturnType<typeof getCurrentWorkspace>>
type BatchRow = Record<string, any>

type PreviewResult = {
  inserted: number
  failed: number
  found: number
  status: 'preview_ready' | 'failed'
}

function text(formData: FormData, key: string) {
  const value = String(formData.get(key) || '').trim()
  return value || null
}

function visibilityValue(formData: FormData) {
  const value = String(formData.get('visibility') || 'private')
  return value === 'team' || value === 'community' || value === 'public' ? value : 'private'
}

function selectedPreviewIds(formData: FormData) {
  const all = formData.getAll('preview_item_id').map((value) => String(value || '').trim()).filter(Boolean)
  const single = String(formData.get('preview_item_ids') || '').split(',').map((value) => value.trim()).filter(Boolean)
  return [...new Set([...all, ...single])]
}

function normalizedAddressFor(value: { address?: string | null; city?: string | null; state?: string | null }) {
  return [value.address, value.city, value.state].filter(Boolean).join(', ').toLowerCase().trim()
}

async function importPolicyForSource(supabase: SupabaseServer, organizationId: string, sourceType: string) {
  const { data } = await supabase
    .from('market_provider_policies')
    .select('*')
    .or(`organization_id.eq.${organizationId},organization_id.is.null`)
    .eq('source_type', sourceType)
    .order('organization_id', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  return providerPolicyFromRow(sourceType, data as any)
}

async function countRecentProviderImports(supabase: SupabaseServer, organizationId: string, sourceType: string) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count } = await supabase
    .from('market_import_audit_events')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('event_type', 'listing_imported')
    .gte('created_at', since)
    .contains('metadata', { sourceType })
  return count || 0
}

async function auditImportEvent(supabase: SupabaseServer, params: { organizationId: string; userId?: string | null; batchId?: string | null; listingId?: string | null; eventType: string; message: string; metadata?: Record<string, any> }) {
  await supabase.from('market_import_audit_events').insert({
    organization_id: params.organizationId,
    user_id: params.userId || null,
    import_batch_id: params.batchId || null,
    listing_id: params.listingId || null,
    event_type: params.eventType,
    message: params.message,
    metadata: params.metadata || {},
  })
}

async function findDuplicateListing(supabase: SupabaseServer, organizationId: string, normalized: any) {
  if (normalized.source_url) {
    const { data } = await supabase
      .from('market_listings')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('source_url', normalized.source_url)
      .maybeSingle()
    if (data) return data
  }

  if (normalized.source_type && normalized.external_listing_id) {
    const { data } = await supabase
      .from('market_listings')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('source_type', normalized.source_type)
      .eq('external_listing_id', normalized.external_listing_id)
      .maybeSingle()
    if (data) return data
  }

  const normalizedAddress = normalizedAddressFor(normalized)
  if (normalizedAddress && normalized.zip_code) {
    const { data } = await supabase
      .from('market_listings')
      .select('id')
      .eq('organization_id', organizationId)
      .ilike('address', normalized.address || '')
      .eq('zip_code', normalized.zip_code)
      .maybeSingle()
    if (data) return data
  }

  return null
}

async function findIgnoredListing(supabase: SupabaseServer, organizationId: string, normalized: any, fallbackUrl: string) {
  const sourceUrl = normalized.source_url || fallbackUrl
  if (sourceUrl) {
    const { data } = await supabase
      .from('market_ignored_listings')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('source_url', sourceUrl)
      .maybeSingle()
    if (data) return data
  }

  const normalizedAddress = normalizedAddressFor(normalized)
  if (normalizedAddress && normalized.zip_code) {
    const { data } = await supabase
      .from('market_ignored_listings')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('normalized_address', normalizedAddress)
      .eq('zip_code', normalized.zip_code)
      .maybeSingle()
    if (data) return data
  }

  return null
}

async function createPreviewForBatch(params: { supabase: SupabaseServer; workspace: Workspace; batch: BatchRow }): Promise<PreviewResult> {
  const { supabase, workspace, batch } = params
  if (!workspace.organization?.id) throw new Error('Missing organization')

  const batchId = String(batch.id)
  const sourceType = String(batch.source_type || 'generic')
  const policy = await importPolicyForSource(supabase, workspace.organization.id, sourceType)

  if (!policy.active) throw new Error(`${policy.label} import is not active. Configure provider policy before live import.`)
  if (batch.import_mode === 'search_url' && !policy.searchImportAllowed) throw new Error(`${policy.label} search import is not allowed by current provider policy.`)
  if (batch.import_mode !== 'search_url' && !policy.listingImportAllowed) throw new Error(`${policy.label} listing import is not allowed by current provider policy.`)

  const recent = await countRecentProviderImports(supabase, workspace.organization.id, sourceType)
  const remaining = Math.max(0, policy.maxListingsPerHour - recent)
  if (remaining <= 0) {
    const next = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    await supabase
      .from('market_url_import_batches')
      .update({ status: 'rate_limited', next_allowed_import_at: next, policy_snapshot: providerPolicySnapshot(policy) })
      .eq('id', batchId)
      .eq('organization_id', workspace.organization.id)
    await auditImportEvent(supabase, { organizationId: workspace.organization.id, userId: workspace.user.id, batchId, eventType: 'rate_limit_hit', message: `${policy.label} rate limit reached.`, metadata: { sourceType, maxListingsPerHour: policy.maxListingsPerHour } })
    throw new Error(`${policy.label} rate limit reached. Try again after the rolling hour window.`)
  }

  await auditImportEvent(supabase, { organizationId: workspace.organization.id, userId: workspace.user.id, batchId, eventType: 'preview_started', message: 'Import preview started.', metadata: { sourceType, policy: providerPolicySnapshot(policy) } })

  const sourceUrl = String(batch.normalized_url || batch.input_url || '')
  const urls = batch.import_mode === 'search_url'
    ? await discoverListingUrlsFromSearchUrl(sourceUrl, sourceType, Math.min(remaining, sourceType === 'investorlift' ? 40 : 10))
    : [sourceUrl]

  const previewEntries = urls as Array<string | { url: string; sourceType?: string | null; sourceUrl?: string | null; order?: number | null }>

  if (!previewEntries.length) throw new Error('No eligible listing URLs were found on the source page.')

  await supabase
    .from('market_import_preview_items')
    .delete()
    .eq('import_batch_id', batchId)
    .eq('organization_id', workspace.organization.id)
    .in('status', ['new', 'failed', 'duplicate', 'existing', 'ignored'])

  let inserted = 0
  let failed = 0
  const isSearchPreview = batch.import_mode === 'search_url'
  for (const entry of previewEntries.slice(0, Math.min(remaining, sourceType === 'investorlift' ? 40 : 10))) {
    const listingUrl = typeof entry === 'string' ? entry : String(entry.url || '').trim()
    const entrySourceType = typeof entry === 'string' ? sourceType : String(entry.sourceType || sourceType)
    const entrySourceUrl = typeof entry === 'string' ? listingUrl : String(entry.sourceUrl || listingUrl)
    const order = typeof entry === 'string' ? inserted + failed + 1 : Number(entry.order || inserted + failed + 1)

    if (!listingUrl) {
      failed += 1
      continue
    }

    try {
      if (isSearchPreview) {
        await supabase.from('market_import_preview_items').insert({
          organization_id: workspace.organization.id,
          import_batch_id: batchId,
          source_type: entrySourceType,
          source_url: listingUrl || entrySourceUrl,
          title: `Listing ${order} from ${policy.label} search`,
          normalized_listing: {},
          status: 'new',
          data_quality: {
            checklist: [
              { label: 'Listing URL found', status: 'ok' },
              { label: 'Details fetched during import', status: 'pending' },
            ],
            lightweightPreview: true,
            policy: providerPolicySnapshot(policy),
          },
        })
        inserted += 1
        continue
      }

      const normalized = await fetchAndNormalizeMarketUrl(listingUrl, entrySourceType)
      const [duplicate, ignored] = await Promise.all([
        findDuplicateListing(supabase, workspace.organization.id, normalized),
        findIgnoredListing(supabase, workspace.organization.id, normalized, listingUrl),
      ])
      const dataQuality = buildDataQualityChecklist(normalized)
      const status = ignored ? 'ignored' : duplicate ? 'duplicate' : 'new'
      await supabase.from('market_import_preview_items').insert({
        organization_id: workspace.organization.id,
        import_batch_id: batchId,
        source_type: entrySourceType,
        source_url: normalized.source_url || listingUrl,
        external_listing_id: normalized.external_listing_id,
        title: normalized.title,
        address: normalized.address,
        city: normalized.city,
        state: normalized.state,
        zip_code: normalized.zip_code,
        price: normalized.list_price || normalized.asking_price,
        bedrooms: normalized.bedrooms,
        bathrooms: normalized.bathrooms,
        sqft: normalized.sqft,
        asset_class: ['crexi', 'loopnet'].includes(entrySourceType) ? 'commercial' : 'residential',
        property_type: normalized.property_type,
        image_url: normalized.primary_image_url,
        normalized_listing: normalized as any,
        status,
        duplicate_listing_id: (duplicate as any)?.id || null,
        ignored: Boolean(ignored),
        ignore_reason: (ignored as any)?.reason || null,
        data_quality: { checklist: dataQuality, policy: providerPolicySnapshot(policy) },
      })
      inserted += 1
    } catch (error) {
      failed += 1
      await supabase.from('market_import_preview_items').insert({
        organization_id: workspace.organization.id,
        import_batch_id: batchId,
        source_type: entrySourceType,
        source_url: listingUrl || entrySourceUrl,
        title: listingUrl || entrySourceUrl,
        normalized_listing: {},
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Preview failed',
        data_quality: { checklist: [] },
      })
    }
  }

  const expiresAt = new Date(Date.now() + policy.storageDays * 24 * 60 * 60 * 1000).toISOString()
  const status = failed && !inserted ? 'failed' : 'preview_ready'
  await supabase.from('market_url_import_batches').update({
    status,
    total_found: urls.length,
    failed_count: failed,
    policy_snapshot: providerPolicySnapshot(policy),
    provider_data_expires_at: expiresAt,
    last_error: failed && !inserted ? 'Preview failed for all eligible URLs.' : null,
    queue_summary: { ...((batch as any).queue_summary || {}), previewCount: inserted, failedCount: failed, policy: providerPolicySnapshot(policy) },
  }).eq('id', batchId).eq('organization_id', workspace.organization.id)

  await auditImportEvent(supabase, { organizationId: workspace.organization.id, userId: workspace.user.id, batchId, eventType: 'preview_generated', message: `Preview generated with ${inserted} importable listing(s).`, metadata: { found: urls.length, inserted, failed, sourceType } })
  return { inserted, failed, found: urls.length, status }
}

export async function analyzeImportUrlAction(formData: FormData) {
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  if (!canUseFeature(workspace.access.features, 'market_source_imports') && !workspace.access.isPlatformAdmin) {
    redirect(`/imports?error=${encodeURIComponent('URL Import Analyzer is included with Source Imports. Upgrade to use it.')}`)
  }

  const inputUrl = text(formData, 'input_url')
  if (!inputUrl) redirect(`/imports?error=${encodeURIComponent('Paste a source URL first.')}`)
  const visibility = visibilityValue(formData)
  const supabase = await createSupabaseServerClient()

  let analysis
  try {
    analysis = analyzeMarketUrl(inputUrl)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not analyze URL'
    redirect(`/imports?error=${encodeURIComponent(message)}`)
  }

  const sourceName = text(formData, 'source_name') || analysis.title
  const { data: batch, error } = await supabase.from('market_url_import_batches').insert({
    organization_id: workspace.organization.id,
    created_by: workspace.user.id,
    source_type: analysis.sourceType,
    import_mode: analysis.importMode,
    status: 'running',
    input_url: analysis.inputUrl,
    normalized_url: analysis.normalizedUrl,
    source_name: sourceName,
    title: analysis.title,
    summary: analysis.summary,
    target_city: analysis.targetCity,
    target_state: analysis.targetState,
    target_zip: analysis.targetZip,
    min_price: analysis.minPrice,
    max_price: analysis.maxPrice,
    map_bounds: analysis.mapBounds,
    parsed_query: analysis.parsed,
    queue_summary: {
      isSearchUrl: analysis.isSearchUrl,
      isListingUrl: analysis.isListingUrl,
      importMode: analysis.importMode,
      searchTerm: analysis.searchTerm,
      category: analysis.category,
      regionId: analysis.regionId,
      regionType: analysis.regionType,
      note: analysis.isSearchUrl
        ? 'Search URL analyzed. Real provider preview generation starts immediately under provider policy.'
        : 'Listing URL analyzed. Real provider preview generation starts immediately under provider policy.',
    },
    visibility,
  }).select('*').single()

  if (error || !batch) redirect(`/imports?error=${encodeURIComponent(error?.message || 'Could not create import batch')}`)

  await createInAppNotification(supabase, {
    organizationId: workspace.organization.id,
    userId: workspace.user.id,
    actorId: workspace.user.id,
    type: 'import_analyzed',
    title: analysis.isSearchUrl ? 'Search URL analyzed' : 'Listing URL analyzed',
    message: analysis.summary,
    relatedEntityType: 'market_url_import_batch',
    relatedEntityId: batch.id,
    actionHref: `/imports?batch=${batch.id}`,
    metadata: { sourceType: analysis.sourceType, importMode: analysis.importMode, targetZip: analysis.targetZip, maxPrice: analysis.maxPrice },
  })

  await supabase.from('audit_logs').insert({
    organization_id: workspace.organization.id,
    actor_id: workspace.user.id,
    event_type: 'market_import.url_analyzed',
    entity_type: 'market_url_import_batch',
    entity_id: batch.id,
    metadata: { sourceType: analysis.sourceType, importMode: analysis.importMode, inputUrl: analysis.normalizedUrl },
  })

  try {
    const preview = await createPreviewForBatch({ supabase, workspace, batch: batch as any })
    await createInAppNotification(supabase, {
      organizationId: workspace.organization.id,
      userId: workspace.user.id,
      actorId: workspace.user.id,
      type: 'import_preview_ready',
      title: 'Import preview ready',
      message: `${preview.inserted} listing(s) ready to import from ${analysis.sourceType}.`,
      relatedEntityType: 'market_url_import_batch',
      relatedEntityId: batch.id,
      actionHref: `/imports?batch=${batch.id}`,
      metadata: { sourceType: analysis.sourceType, found: preview.found, inserted: preview.inserted, failed: preview.failed },
    })
    revalidatePath('/imports')
    revalidatePath('/notifications')
    redirect(`/imports?batch=${batch.id}&saved=preview`)
  } catch (previewError) {
    const message = previewError instanceof Error ? previewError.message : 'Preview generation failed'
    await supabase.from('market_url_import_batches').update({ status: 'failed', last_error: message }).eq('id', batch.id).eq('organization_id', workspace.organization.id)
    await auditImportEvent(supabase, { organizationId: workspace.organization.id, userId: workspace.user.id, batchId: batch.id, eventType: 'import_failed', message, metadata: { sourceType: analysis.sourceType, importMode: analysis.importMode } })
    revalidatePath('/imports')
    revalidatePath('/notifications')
    redirect(`/imports?batch=${batch.id}&error=${encodeURIComponent(message)}`)
  }
}

export async function updateImportBatchStatusAction(formData: FormData) {
  const batchId = String(formData.get('batch_id') || '').trim()
  const status = String(formData.get('status') || 'analyzed')
  const safeStatus = ['draft','analyzed','ready','queued','preview_ready','running','importing','rate_limited','partially_imported','completed','needs_review','failed','cancelled','expired_provider_data'].includes(status) ? status : 'analyzed'
  if (!batchId) redirect('/imports?error=Missing batch id')
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  const supabase = await createSupabaseServerClient()
  const updates: Record<string, any> = { status: safeStatus }
  if (safeStatus === 'completed') updates.completed_at = new Date().toISOString()
  if (safeStatus === 'needs_review') updates.reviewed_at = new Date().toISOString()
  const { error } = await supabase
    .from('market_url_import_batches')
    .update(updates)
    .eq('id', batchId)
    .eq('organization_id', workspace.organization.id)
  if (error) redirect(`/imports?error=${encodeURIComponent(error.message)}`)
  revalidatePath('/imports')
  redirect(`/imports?batch=${batchId}&saved=status`)
}

export async function generateImportPreviewAction(formData: FormData) {
  const batchId = String(formData.get('batch_id') || '').trim()
  if (!batchId) redirect('/imports?error=Missing batch id')
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  if (!canUseFeature(workspace.access.features, 'market_source_imports') && !workspace.access.isPlatformAdmin) redirect('/imports?error=Source imports are not enabled')
  const supabase = await createSupabaseServerClient()
  const { data: batch, error: batchError } = await supabase
    .from('market_url_import_batches')
    .select('*')
    .eq('id', batchId)
    .eq('organization_id', workspace.organization.id)
    .maybeSingle()
  if (batchError || !batch) redirect(`/imports?error=${encodeURIComponent(batchError?.message || 'Import batch not found')}`)

  try {
    await createPreviewForBatch({ supabase, workspace, batch: batch as any })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not generate preview'
    await supabase.from('market_url_import_batches').update({ status: 'failed', last_error: message }).eq('id', batchId).eq('organization_id', workspace.organization.id)
    await auditImportEvent(supabase, { organizationId: workspace.organization.id, userId: workspace.user.id, batchId, eventType: 'import_failed', message, metadata: { sourceType: String((batch as any).source_type || 'generic') } })
    redirect(`/imports?batch=${batchId}&error=${encodeURIComponent(message)}`)
  }

  revalidatePath('/imports')
  redirect(`/imports?batch=${batchId}&saved=preview`)
}

export async function importPreviewItemsAction(formData: FormData) {
  const batchId = String(formData.get('batch_id') || '').trim()
  if (!batchId) redirect('/imports?error=Missing batch id')
  const ids = selectedPreviewIds(formData)
  const importFirst10 = String(formData.get('import_first_10') || '') === 'true'
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  if (!canUseFeature(workspace.access.features, 'market_source_imports') && !workspace.access.isPlatformAdmin) redirect('/imports?error=Source imports are not enabled')
  const supabase = await createSupabaseServerClient()
  const { data: batch } = await supabase.from('market_url_import_batches').select('*').eq('id', batchId).eq('organization_id', workspace.organization.id).maybeSingle()
  if (!batch) redirect('/imports?error=Import batch not found')
  const sourceType = String((batch as any).source_type || 'generic')
  const policy = await importPolicyForSource(supabase, workspace.organization.id, sourceType)
  const recent = await countRecentProviderImports(supabase, workspace.organization.id, sourceType)
  const remaining = Math.max(0, policy.maxListingsPerHour - recent)
  if (remaining <= 0) redirect(`/imports?batch=${batchId}&error=${encodeURIComponent(`${policy.label} rate limit reached.`)}`)

  let query = supabase.from('market_import_preview_items').select('*').eq('organization_id', workspace.organization.id).eq('import_batch_id', batchId).in('status', ['new', 'duplicate', 'existing'])
  if (!importFirst10) {
    if (!ids.length) redirect(`/imports?batch=${batchId}&error=${encodeURIComponent('Select at least one preview item to import.')}`)
    query = query.in('id', ids)
  }
  const { data: items, error } = await query.order('created_at', { ascending: true }).limit(Math.min(remaining, sourceType === 'investorlift' ? 40 : 10))
  if (error) redirect(`/imports?batch=${batchId}&error=${encodeURIComponent(error.message)}`)
  if (!items?.length) redirect(`/imports?batch=${batchId}&error=${encodeURIComponent('No importable preview items found. Generate preview first, or select rows with status new/duplicate/existing.')}`)

  let created = 0
  let updated = 0
  let failed = 0
  const importedListingIds: string[] = []
  for (const item of items as any[]) {
    try {
      const normalized = item.normalized_listing && Object.keys(item.normalized_listing || {}).length
        ? item.normalized_listing
        : await fetchAndNormalizeMarketUrl(String(item.source_url || ''), String(item.source_type || sourceType))
      const duplicate = await findDuplicateListing(supabase, workspace.organization.id, normalized)
      const ignored = await findIgnoredListing(supabase, workspace.organization.id, normalized, String(item.source_url || ''))
      if (ignored) throw new Error(`Ignored previously${(ignored as any)?.reason ? ` — ${(ignored as any).reason}` : ''}`)
      const expiresAt = new Date(Date.now() + policy.storageDays * 24 * 60 * 60 * 1000).toISOString()
      normalized.raw_payload = { ...(normalized.raw_payload || {}), providerPolicy: providerPolicySnapshot(policy), providerDataExpiresAt: expiresAt, duplicateListingId: (duplicate as any)?.id || null }
      const result = await upsertMarketListingFromNormalized({
        supabase: supabase as any,
        listing: normalized,
        organizationId: workspace.organization.id,
        userId: workspace.user.id,
        visibility: (batch as any).visibility || 'private',
      })
      await supabase.from('market_listings').update({
        provider_attribution: policy.attributionRequired ? `Source: ${policy.label}` : null,
        source_policy_snapshot: providerPolicySnapshot(policy),
        provider_data_expires_at: expiresAt,
        deal_stage: 'imported',
      }).eq('id', result.listing.id).eq('organization_id', workspace.organization.id)
      const { data: refreshed } = await supabase.from('market_listings').select('*').eq('id', result.listing.id).maybeSingle()
      try {
        await runListingRentIntelligence({ supabase, organizationId: workspace.organization.id, userId: workspace.user.id, listing: refreshed || result.listing })
      } catch (intelligenceError) {
        await auditImportEvent(supabase, { organizationId: workspace.organization.id, userId: workspace.user.id, batchId, listingId: result.listing.id, eventType: 'rent_analysis_failed', message: intelligenceError instanceof Error ? intelligenceError.message : 'Rent intelligence failed', metadata: { sourceType } })
      }
      const { data: score } = await supabase.from('market_listing_scores').select('*').eq('listing_id', result.listing.id).order('calculated_at', { ascending: false }).limit(1).maybeSingle()
      await supabase.from('market_listings').update({
        data_quality_checklist: buildDataQualityChecklist(refreshed || result.listing, score),
        confidence_breakdown: buildConfidenceBreakdown(refreshed || result.listing, score),
      }).eq('id', result.listing.id).eq('organization_id', workspace.organization.id)
      importedListingIds.push(String(result.listing.id))
      await supabase.from('market_import_preview_items').update({ status: 'imported', imported_listing_id: result.listing.id, imported_at: new Date().toISOString() }).eq('id', item.id)
      await auditImportEvent(supabase, { organizationId: workspace.organization.id, userId: workspace.user.id, batchId, listingId: result.listing.id, eventType: 'listing_imported', message: result.created ? 'Listing imported.' : 'Listing updated from import.', metadata: { sourceType, sourceUrl: item.source_url } })
      if (result.created) created += 1
      else updated += 1
    } catch (error) {
      failed += 1
      await supabase.from('market_import_preview_items').update({ status: 'failed', error_message: error instanceof Error ? error.message : 'Import failed' }).eq('id', item.id)
    }
  }

  const finalStatus = failed && (created + updated) ? 'partially_imported' : failed ? 'failed' : 'completed'
  await supabase.from('market_url_import_batches').update({
    status: finalStatus,
    imported_count: created + updated,
    failed_count: failed,
    completed_at: finalStatus === 'completed' ? new Date().toISOString() : null,
  }).eq('id', batchId).eq('organization_id', workspace.organization.id)
  await createInAppNotification(supabase, {
    organizationId: workspace.organization.id,
    userId: workspace.user.id,
    actorId: workspace.user.id,
    type: finalStatus === 'failed' ? 'import_failed' : 'import_completed',
    title: finalStatus === 'failed' ? 'Import failed' : 'Import completed',
    message: `${created} created · ${updated} updated · ${failed} failed.`,
    relatedEntityType: 'market_url_import_batch',
    relatedEntityId: batchId,
    actionHref: `/imports?batch=${batchId}`,
    metadata: { created, updated, failed, sourceType, importedListingIds },
  })
  revalidatePath('/imports')
  revalidatePath('/market')
  revalidatePath('/notifications')
  redirect(importedListingIds[0] ? `/market/${importedListingIds[0]}?batch=${batchId}&saved=imported` : `/imports?batch=${batchId}&saved=imported`)
}

export async function skipPreviewItemsAction(formData: FormData) {
  const batchId = String(formData.get('batch_id') || '').trim()
  const ids = selectedPreviewIds(formData)
  if (!batchId || !ids.length) redirect(`/imports?batch=${batchId}&error=${encodeURIComponent('Select preview items to skip.')}`)
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  const supabase = await createSupabaseServerClient()
  await supabase.from('market_import_preview_items').update({ status: 'skipped' }).eq('organization_id', workspace.organization.id).eq('import_batch_id', batchId).in('id', ids)
  await auditImportEvent(supabase, { organizationId: workspace.organization.id, userId: workspace.user.id, batchId, eventType: 'listing_skipped', message: `${ids.length} preview item(s) skipped.`, metadata: { ids } })
  revalidatePath('/imports')
  redirect(`/imports?batch=${batchId}&saved=skipped`)
}

export async function runProviderCleanupAction() {
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('cleanup_expired_market_source_data')
  if (error) redirect(`/imports?error=${encodeURIComponent(error.message)}`)
  const cleaned = Array.isArray(data) ? Number((data[0] as any)?.cleaned_count || 0) : Number(data || 0)
  await auditImportEvent(supabase, { organizationId: workspace.organization.id, userId: workspace.user.id, eventType: 'cleanup_completed', message: `Provider retention cleanup completed. ${cleaned} listing(s) cleaned.`, metadata: { cleaned } })
  await createInAppNotification(supabase, { organizationId: workspace.organization.id, userId: workspace.user.id, actorId: workspace.user.id, type: 'cleanup_completed', title: 'Provider cleanup completed', message: `${cleaned} expired provider record(s) cleaned.`, actionHref: '/imports', metadata: { cleaned } })
  revalidatePath('/imports')
  redirect('/imports?saved=cleanup')
}
