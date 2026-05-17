'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { canUseFeature } from '@/lib/billing/features'

function text(formData: FormData, key: string) {
  const value = String(formData.get(key) || '').trim()
  return value || null
}

function sourceType(formData: FormData) {
  const value = String(formData.get('source_type') || 'other')
  return ['zillow', 'crexi', 'apartments', 'realtor', 'redfin', 'investorlift', 'csv', 'licensed_api', 'other'].includes(value) ? value : 'other'
}

export async function createMarketSourceImportAction(formData: FormData) {
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')

  if (!canUseFeature(workspace.access.features, 'market_source_imports')) {
    redirect('/market-search?error=Market source imports are a premium feature. Upgrade to Team, Community/Guru, or enable an admin override.')
  }

  const sourceUrl = text(formData, 'source_url')
  const searchMarket = text(formData, 'search_market')
  const searchZip = text(formData, 'search_zip')
  if (!sourceUrl && !searchMarket && !searchZip) redirect('/market-search?error=Enter a source URL, market, or ZIP before starting an import.')

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.from('market_source_imports').insert({
    organization_id: workspace.organization.id,
    created_by: workspace.user.id,
    source_type: sourceType(formData),
    source_url: sourceUrl,
    search_market: searchMarket,
    search_zip: searchZip,
    property_type: text(formData, 'property_type'),
    strategy: text(formData, 'strategy'),
    status: 'queued',
    notes: text(formData, 'notes') || 'Queued for authorized source ingestion. Review results before turning them into deals or comps.',
    raw_payload: {
      source: 'market_search_form',
      createdAt: new Date().toISOString(),
    },
  })

  if (error) redirect(`/market-search?error=${encodeURIComponent(error.message)}`)

  await supabase.from('audit_logs').insert({
    organization_id: workspace.organization.id,
    actor_id: workspace.user.id,
    event_type: 'market_source_import.queued',
    entity_type: 'market_source_import',
    metadata: { source_type: sourceType(formData), source_url: sourceUrl, search_market: searchMarket, search_zip: searchZip },
  })

  revalidatePath('/market-search')
  redirect('/market-search?saved=source_import')
}
