'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { HUDUSER_DEFAULT_YEAR, lookupHudFmrByZip } from '@/lib/integrations/hud/fmrClient'
import { importZillowRentalByUrl } from '@/lib/integrations/zillow/zillowClient'
import { summarizeMarketRentComps } from '@/lib/underwriting/rentIntelligence'

function text(formData: FormData, key: string) {
  const value = String(formData.get(key) || '').trim()
  return value || null
}

function numberValue(formData: FormData, key: string) {
  const raw = String(formData.get(key) || '').trim().replace(',', '.')
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function intValue(formData: FormData, key: string) {
  const value = numberValue(formData, key)
  return value === null ? null : Math.round(value)
}

function sourceType(formData: FormData) {
  const value = String(formData.get('source_type') || 'manual')
  return ['manual', 'zillow_url', 'licensed_api', 'csv_upload', 'pdf_upload', 'ai_extracted', 'other'].includes(value) ? value : 'manual'
}

async function requireDeal(dealId: string) {
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  const supabase = await createSupabaseServerClient()
  const { data: deal, error } = await supabase
    .from('deals')
    .select('*, properties(*)')
    .eq('id', dealId)
    .eq('organization_id', workspace.organization.id)
    .maybeSingle()
  if (error || !deal) redirect(`/deals?error=${encodeURIComponent(error?.message || 'Deal not found')}`)
  const property = Array.isArray((deal as any).properties) ? (deal as any).properties[0] : (deal as any).properties
  return { workspace, supabase, deal: deal as any, property: property as any }
}

async function refreshMarketRentFromComps(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, organizationId: string, dealId: string) {
  const { data: comps } = await supabase
    .from('market_rent_comps')
    .select('monthly_rent, bedrooms, square_feet, confidence_score')
    .eq('organization_id', organizationId)
    .eq('deal_id', dealId)
  const summary = summarizeMarketRentComps((comps || []) as any)
  if (summary.recommendedRent) {
    await supabase
      .from('deals')
      .update({ market_rent: Math.round(summary.recommendedRent) })
      .eq('organization_id', organizationId)
      .eq('id', dealId)
  }
  return summary
}

export async function addMarketRentCompAction(formData: FormData) {
  const dealId = String(formData.get('deal_id') || '').trim()
  if (!dealId) redirect('/deals?error=Missing deal id')

  const { workspace, supabase, property } = await requireDeal(dealId)
  const monthlyRent = numberValue(formData, 'monthly_rent')
  if (monthlyRent === null || monthlyRent < 0) redirect(`/deals/${dealId}/rent-intelligence?error=Monthly rent is required`)

  const { error } = await supabase.from('market_rent_comps').insert({
    organization_id: workspace.organization!.id,
    deal_id: dealId,
    created_by: workspace.user.id,
    source_type: sourceType(formData),
    source_name: text(formData, 'source_name'),
    source_url: text(formData, 'source_url'),
    comp_address: text(formData, 'comp_address'),
    city: text(formData, 'city') || property?.city || null,
    state: text(formData, 'state') || property?.state || null,
    zip_code: text(formData, 'zip_code') || property?.zip_code || null,
    bedrooms: numberValue(formData, 'bedrooms') ?? property?.bedrooms ?? null,
    bathrooms: numberValue(formData, 'bathrooms') ?? property?.bathrooms ?? null,
    square_feet: intValue(formData, 'square_feet'),
    monthly_rent: monthlyRent,
    distance_miles: numberValue(formData, 'distance_miles'),
    listing_date: text(formData, 'listing_date'),
    notes: text(formData, 'notes'),
    confidence_score: intValue(formData, 'confidence_score'),
  })

  if (error) redirect(`/deals/${dealId}/rent-intelligence?error=${encodeURIComponent(error.message)}`)

  if (formData.get('apply_to_deal') === 'on') {
    await refreshMarketRentFromComps(supabase, workspace.organization!.id, dealId)
  }

  await supabase.from('audit_logs').insert({
    organization_id: workspace.organization!.id,
    actor_id: workspace.user.id,
    event_type: 'market_rent_comp.created',
    entity_type: 'deal',
    entity_id: dealId,
    metadata: { source_type: sourceType(formData), monthly_rent: monthlyRent },
  })

  revalidatePath(`/deals/${dealId}`)
  revalidatePath(`/deals/${dealId}/rent-intelligence`)
  redirect(`/deals/${dealId}/rent-intelligence?saved=comp`)
}


export async function importZillowMarketRentCompAction(formData: FormData) {
  const dealId = String(formData.get('deal_id') || '').trim()
  if (!dealId) redirect('/deals?error=Missing deal id')

  const { workspace, supabase, property } = await requireDeal(dealId)
  const sourceUrl = text(formData, 'zillow_url') || ''
  const manualRentOverride = numberValue(formData, 'monthly_rent_override')

  try {
    const imported = await importZillowRentalByUrl(sourceUrl)
    const monthlyRent = manualRentOverride ?? imported.monthlyRent
    if (!monthlyRent) throw new Error('Zillow import succeeded but rent was missing. Enter a manual rent override.')

    const { error } = await supabase.from('market_rent_comps').insert({
      organization_id: workspace.organization!.id,
      deal_id: dealId,
      created_by: workspace.user.id,
      source_type: 'zillow_url',
      source_name: imported.sourceName,
      source_url: imported.sourceUrl,
      external_listing_id: imported.externalListingId,
      comp_address: imported.compAddress,
      city: imported.city || property?.city || null,
      state: imported.state || property?.state || null,
      zip_code: imported.zipCode || property?.zip_code || null,
      bedrooms: imported.bedrooms ?? property?.bedrooms ?? null,
      bathrooms: imported.bathrooms ?? property?.bathrooms ?? null,
      square_feet: imported.squareFeet,
      monthly_rent: monthlyRent,
      listing_date: imported.listingDate,
      notes: imported.notes,
      confidence_score: manualRentOverride ? 80 : 70,
      import_status: 'imported',
      raw_payload: imported.raw as any,
    })

    if (error) redirect(`/deals/${dealId}/rent-intelligence?error=${encodeURIComponent(error.message)}`)

    if (formData.get('apply_to_deal') === 'on') {
      await refreshMarketRentFromComps(supabase, workspace.organization!.id, dealId)
    }

    await supabase.from('audit_logs').insert({
      organization_id: workspace.organization!.id,
      actor_id: workspace.user.id,
      event_type: 'market_rent_comp.zillow_imported',
      entity_type: 'deal',
      entity_id: dealId,
      metadata: { source_url: imported.sourceUrl, monthly_rent: monthlyRent, external_listing_id: imported.externalListingId },
    })

    revalidatePath(`/deals/${dealId}`)
    revalidatePath(`/deals/${dealId}/rent-intelligence`)
    redirect(`/deals/${dealId}/rent-intelligence?saved=zillow`)
  } catch (error) {
    await supabase.from('audit_logs').insert({
      organization_id: workspace.organization!.id,
      actor_id: workspace.user.id,
      event_type: 'market_rent_comp.zillow_import_failed',
      entity_type: 'deal',
      entity_id: dealId,
      metadata: { source_url: sourceUrl, error: error instanceof Error ? error.message : 'Unknown Zillow import error' },
    })
    redirect(`/deals/${dealId}/rent-intelligence?error=${encodeURIComponent(error instanceof Error ? error.message : 'Zillow import failed')}`)
  }
}

export async function applyMarketRentSummaryAction(formData: FormData) {
  const dealId = String(formData.get('deal_id') || '').trim()
  if (!dealId) redirect('/deals?error=Missing deal id')
  const { workspace, supabase } = await requireDeal(dealId)
  const summary = await refreshMarketRentFromComps(supabase, workspace.organization!.id, dealId)
  if (!summary.recommendedRent) redirect(`/deals/${dealId}/rent-intelligence?error=Add at least one market rent comp first`)
  revalidatePath(`/deals/${dealId}`)
  redirect(`/deals/${dealId}/rent-intelligence?saved=market_rent`)
}

export async function lookupHudRentAction(formData: FormData) {
  const dealId = String(formData.get('deal_id') || '').trim()
  if (!dealId) redirect('/deals?error=Missing deal id')
  const { workspace, supabase, property } = await requireDeal(dealId)
  const zipCode = text(formData, 'zip_code') || property?.zip_code || ''
  const bedrooms = numberValue(formData, 'bedrooms') ?? property?.bedrooms ?? null
  const hudYear = HUDUSER_DEFAULT_YEAR

  try {
    const result = await lookupHudFmrByZip({ zipCode, bedrooms, hudYear })
    const rent = result.selectedBedroomRent || result.rents[2] || result.rents[1] || result.rents[3] || result.rents[4] || result.rents[0]

    await supabase.from('hud_fmr_cache').upsert({
      zip_code: result.zipCode,
      state: result.state,
      county: result.county,
      metro_area: result.metroArea,
      hud_year: result.hudYear,
      rent_0br: result.rents[0],
      rent_1br: result.rents[1],
      rent_2br: result.rents[2],
      rent_3br: result.rents[3],
      rent_4br: result.rents[4],
      source: 'HUDUSER',
      source_url: result.sourceUrl,
      raw_response: result.raw as any,
      fetched_at: new Date().toISOString(),
    }, { onConflict: 'zip_code,hud_year' })

    if (rent) {
      await supabase.from('deals').update({ section8_rent: rent }).eq('organization_id', workspace.organization!.id).eq('id', dealId)
    }

    await supabase.from('hud_lookup_events').insert({
      organization_id: workspace.organization!.id,
      deal_id: dealId,
      created_by: workspace.user.id,
      zip_code: result.zipCode,
      bedrooms,
      hud_year: result.hudYear,
      status: 'success',
      message: rent ? `Applied ${rent} HUD/FMR benchmark to deal.` : 'HUD lookup succeeded but no selected bedroom rent was found.',
      source_url: result.sourceUrl,
    })

    revalidatePath(`/deals/${dealId}`)
    revalidatePath(`/deals/${dealId}/rent-intelligence`)
    redirect(`/deals/${dealId}/rent-intelligence?saved=hud`)
  } catch (error) {
    await supabase.from('hud_lookup_events').insert({
      organization_id: workspace.organization!.id,
      deal_id: dealId,
      created_by: workspace.user.id,
      zip_code: zipCode || 'missing',
      bedrooms,
      hud_year: hudYear,
      status: 'failed',
      message: error instanceof Error ? error.message : 'HUD lookup failed',
    })
    redirect(`/deals/${dealId}/rent-intelligence?error=${encodeURIComponent(error instanceof Error ? error.message : 'HUD lookup failed')}`)
  }
}
