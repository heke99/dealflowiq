'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { canUseFeature } from '@/lib/billing/features'
import { analyzeMarketUrl } from '@/lib/market/urlAnalyzer'
import { createInAppNotification } from '@/lib/notifications'

function text(formData: FormData, key: string) {
  const value = String(formData.get(key) || '').trim()
  return value || null
}

function visibilityValue(formData: FormData) {
  const value = String(formData.get('visibility') || 'private')
  return value === 'team' || value === 'community' || value === 'public' ? value : 'private'
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
  const status = analysis.isSearchUrl ? 'queued' : 'analyzed'
  const { data: batch, error } = await supabase.from('market_url_import_batches').insert({
    organization_id: workspace.organization.id,
    created_by: workspace.user.id,
    source_type: analysis.sourceType,
    import_mode: analysis.importMode,
    status,
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
        ? 'Search URL analyzed and queued. Add listing URLs, CSV/API data, or approved feed output to create scored listings.'
        : 'Listing URL analyzed. Use Market quick import to fetch/normalize one listing when source access is available.',
    },
    visibility,
  }).select('id').single()

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

  revalidatePath('/imports')
  revalidatePath('/notifications')
  redirect(`/imports?batch=${batch.id}&saved=analyzed`)
}

export async function updateImportBatchStatusAction(formData: FormData) {
  const batchId = String(formData.get('batch_id') || '').trim()
  const status = String(formData.get('status') || 'analyzed')
  const safeStatus = ['analyzed', 'queued', 'importing', 'completed', 'needs_review', 'failed', 'cancelled'].includes(status) ? status : 'analyzed'
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
