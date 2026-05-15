'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { canUseFeature } from '@/lib/billing/features'
import { runMarketSourceNow } from '@/lib/market/importRunner'

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
  return value === null ? null : Math.max(0, Math.round(value))
}

function csvList(formData: FormData, key: string) {
  const raw = String(formData.get(key) || '').trim()
  if (!raw) return []
  return raw.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean).slice(0, 50)
}

function urlList(formData: FormData, key: string) {
  return csvList(formData, key).filter((item) => item.startsWith('http://') || item.startsWith('https://')).slice(0, 50)
}

function scheduleFrequencyValue(formData: FormData) {
  const value = String(formData.get('schedule_frequency') || 'daily')
  return ['manual', 'hourly', 'twice_daily', 'daily', 'weekly'].includes(value) ? value : 'daily'
}

function statusValue(formData: FormData) {
  const value = String(formData.get('status') || 'active')
  return ['active', 'paused', 'archived'].includes(value) ? value : 'active'
}

function sourceTypeValue(formData: FormData) {
  const value = String(formData.get('source_type') || 'zillow')
  return ['zillow', 'crexi', 'loopnet', 'redfin', 'realtor', 'apartments', 'csv', 'partner_api', 'manual_url', 'other'].includes(value) ? value : 'zillow'
}

function nextRunFor(frequency: string) {
  if (frequency === 'manual') return null
  return new Date().toISOString()
}

function requireBuyBoxAccess(workspace: Awaited<ReturnType<typeof getCurrentWorkspace>>) {
  if (!canUseFeature(workspace.access.features, 'scheduled_market_imports') && !workspace.access.isPlatformAdmin) {
    redirect(`/buy-boxes?error=${encodeURIComponent('Buy Boxes and scheduled market discovery are a premium feature.')}`)
  }
}

export async function createBuyBoxAction(formData: FormData) {
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  requireBuyBoxAccess(workspace)
  const supabase = await createSupabaseServerClient()

  const name = text(formData, 'name') || 'Untitled Buy Box'
  const sourceUrls = urlList(formData, 'source_urls')
  const schedule = scheduleFrequencyValue(formData)
  const minDealScore = integerValue(formData, 'min_deal_score') || 80
  const minRentConfidence = integerValue(formData, 'min_rent_confidence') || 65
  const propertyTypes = csvList(formData, 'property_types')
  const sources = csvList(formData, 'sources')

  const { data: buyBox, error } = await supabase.from('market_buy_boxes').insert({
    organization_id: workspace.organization.id,
    created_by: workspace.user.id,
    name,
    description: text(formData, 'description'),
    status: statusValue(formData),
    city: text(formData, 'city'),
    state: text(formData, 'state'),
    zip_code: text(formData, 'zip_code'),
    county: text(formData, 'county'),
    property_types: propertyTypes,
    strategy: text(formData, 'strategy') || 'buy_hold',
    min_price: numberValue(formData, 'min_price'),
    max_price: numberValue(formData, 'max_price'),
    min_units: integerValue(formData, 'min_units'),
    max_units: integerValue(formData, 'max_units'),
    min_bedrooms: numberValue(formData, 'min_bedrooms'),
    min_bathrooms: numberValue(formData, 'min_bathrooms'),
    min_sqft: integerValue(formData, 'min_sqft'),
    min_deal_score: minDealScore,
    min_rent_confidence: minRentConfidence,
    min_cashflow: numberValue(formData, 'min_cashflow'),
    min_dscr: numberValue(formData, 'min_dscr'),
    min_cap_rate: numberValue(formData, 'min_cap_rate'),
    min_hud_rent_gap: numberValue(formData, 'min_hud_rent_gap'),
    min_market_rent_gap: numberValue(formData, 'min_market_rent_gap'),
    sources,
    source_urls: sourceUrls,
    schedule_frequency: schedule,
    next_run_at: nextRunFor(schedule),
    settings: { createdFrom: 'buy_box_ui' },
  }).select('*').single()

  if (error || !buyBox) redirect(`/buy-boxes?error=${encodeURIComponent(error?.message || 'Could not create buy box')}`)

  if (sourceUrls.length) {
    const { data: source } = await supabase.from('market_sources').insert({
      organization_id: workspace.organization.id,
      created_by: workspace.user.id,
      buy_box_id: buyBox.id,
      source_type: sourceTypeValue(formData),
      source_name: `${name} source`,
      access_mode: 'authorized_scrape',
      status: 'active',
      auto_import_enabled: schedule !== 'manual',
      schedule_frequency: schedule === 'manual' ? 'daily' : schedule,
      default_visibility: 'private',
      opportunity_score_threshold: minDealScore,
      next_run_at: schedule === 'manual' ? null : new Date().toISOString(),
      settings: {
        buy_box_id: buyBox.id,
        source_urls: sourceUrls,
        max_urls_per_run: integerValue(formData, 'max_urls_per_run') || 10,
        opportunity_score_threshold: minDealScore,
        min_rent_confidence: minRentConfidence,
        default_visibility: 'private',
      },
    }).select('id').single()

    if (source?.id) {
      await supabase.from('market_source_queue_items').upsert(sourceUrls.map((inputUrl) => ({
        organization_id: workspace.organization!.id,
        source_id: source.id,
        buy_box_id: buyBox.id,
        input_url: inputUrl,
        status: 'queued',
        priority: 60,
      })), { onConflict: 'source_id,input_url' })
    }
  }

  revalidatePath('/buy-boxes')
  revalidatePath('/market')
  redirect(`/buy-boxes/${buyBox.id}?saved=created`)
}

export async function updateBuyBoxAction(formData: FormData) {
  const buyBoxId = String(formData.get('buy_box_id') || '').trim()
  if (!buyBoxId) redirect('/buy-boxes?error=Missing buy box id')
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  requireBuyBoxAccess(workspace)
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase.from('market_buy_boxes').update({
    name: text(formData, 'name') || 'Untitled Buy Box',
    description: text(formData, 'description'),
    status: statusValue(formData),
    city: text(formData, 'city'),
    state: text(formData, 'state'),
    zip_code: text(formData, 'zip_code'),
    property_types: csvList(formData, 'property_types'),
    strategy: text(formData, 'strategy') || 'buy_hold',
    min_price: numberValue(formData, 'min_price'),
    max_price: numberValue(formData, 'max_price'),
    min_units: integerValue(formData, 'min_units'),
    max_units: integerValue(formData, 'max_units'),
    min_deal_score: integerValue(formData, 'min_deal_score') || 80,
    min_rent_confidence: integerValue(formData, 'min_rent_confidence') || 65,
    min_cashflow: numberValue(formData, 'min_cashflow'),
    min_dscr: numberValue(formData, 'min_dscr'),
    min_cap_rate: numberValue(formData, 'min_cap_rate'),
    min_hud_rent_gap: numberValue(formData, 'min_hud_rent_gap'),
    min_market_rent_gap: numberValue(formData, 'min_market_rent_gap'),
    source_urls: urlList(formData, 'source_urls'),
    schedule_frequency: scheduleFrequencyValue(formData),
  }).eq('id', buyBoxId).eq('organization_id', workspace.organization.id)
  if (error) redirect(`/buy-boxes/${buyBoxId}?error=${encodeURIComponent(error.message)}`)

  revalidatePath('/buy-boxes')
  redirect(`/buy-boxes/${buyBoxId}?saved=updated`)
}

export async function runBuyBoxNowAction(formData: FormData) {
  const buyBoxId = String(formData.get('buy_box_id') || '').trim()
  if (!buyBoxId) redirect('/buy-boxes?error=Missing buy box id')
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  requireBuyBoxAccess(workspace)
  const supabase = await createSupabaseServerClient()

  const { data: buyBox, error: buyBoxError } = await supabase.from('market_buy_boxes').select('*').eq('id', buyBoxId).eq('organization_id', workspace.organization.id).maybeSingle()
  if (buyBoxError || !buyBox) redirect(`/buy-boxes?error=${encodeURIComponent(buyBoxError?.message || 'Buy box not found')}`)

  const { data: sources } = await supabase.from('market_sources').select('*').eq('organization_id', workspace.organization.id).eq('buy_box_id', buyBoxId).eq('status', 'active')
  let found = 0
  let opportunities = 0
  let created = 0
  let updated = 0
  let failed = 0

  for (const source of sources || []) {
    const result = await runMarketSourceNow(source as any, { maxUrls: 10 })
    found += result.found
    created += result.created
    updated += result.updated
    failed += result.failed
    opportunities += result.topScore >= Number(buyBox.min_deal_score || 80) ? 1 : 0
  }

  await supabase.from('market_buy_boxes').update({
    last_run_at: new Date().toISOString(),
    next_run_at: null,
    last_results_count: found,
    last_opportunities_count: opportunities,
    last_error: failed ? `${failed} imports failed during run.` : null,
    settings: { ...(buyBox.settings || {}), lastRunSummary: { found, created, updated, failed, opportunities, ranAt: new Date().toISOString() } },
  }).eq('id', buyBoxId)

  revalidatePath('/buy-boxes')
  revalidatePath('/market')
  redirect(`/buy-boxes/${buyBoxId}?saved=run`)
}

export async function archiveBuyBoxAction(formData: FormData) {
  const buyBoxId = String(formData.get('buy_box_id') || '').trim()
  if (!buyBoxId) redirect('/buy-boxes?error=Missing buy box id')
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  const supabase = await createSupabaseServerClient()
  await supabase.from('market_buy_boxes').update({ status: 'archived' }).eq('id', buyBoxId).eq('organization_id', workspace.organization.id)
  await supabase.from('market_sources').update({ status: 'archived', auto_import_enabled: false }).eq('buy_box_id', buyBoxId).eq('organization_id', workspace.organization.id)
  revalidatePath('/buy-boxes')
  redirect('/buy-boxes?saved=archived')
}
