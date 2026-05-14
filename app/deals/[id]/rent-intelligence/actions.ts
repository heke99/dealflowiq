'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { lookupHudFmrByZip } from '@/lib/integrations/hud/fmrClient'
import { importZillowRentalByUrl } from '@/lib/integrations/zillow/zillowClient'
import { MAX_REASONABLE_MONTHLY_RENT, MIN_REASONABLE_MONTHLY_RENT, isReasonableMonthlyRent, summarizeMarketRentComps } from '@/lib/underwriting/rentIntelligence'

function text(formData: FormData, key: string) {
  const value = String(formData.get(key) || '').trim()
  return value || null
}

function numberValue(formData: FormData, key: string) {
  const raw = String(formData.get(key) || '').trim()
  if (!raw) return null
  const cleaned = raw.replace(/[$\s]/g, '').replace(/,/g, '')
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function rentValue(formData: FormData, key: string) {
  const value = numberValue(formData, key)
  return value !== null && isReasonableMonthlyRent(value) ? value : null
}

function invalidRentRedirect(dealId: string, label: string) {
  redirect(`/deals/${dealId}/rent-intelligence?error=${encodeURIComponent(`${label} must be a realistic monthly rent between $${MIN_REASONABLE_MONTHLY_RENT.toLocaleString()} and $${MAX_REASONABLE_MONTHLY_RENT.toLocaleString()}. If this is a sale price, do not use it as monthly rent.`)}`)
}

function intValue(formData: FormData, key: string) {
  const value = numberValue(formData, key)
  return value === null ? null : Math.round(value)
}

function sourceType(formData: FormData) {
  const value = String(formData.get('source_type') || 'manual')
  return ['manual', 'zillow_url', 'crexi_url', 'licensed_api', 'csv_upload', 'pdf_upload', 'ai_extracted', 'other'].includes(value) ? value : 'manual'
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
    .select('monthly_rent, bedrooms, square_feet, confidence_score, import_status')
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

async function applyHudLookupToDeal(params: {
  dealId: string
  zipCode: string
  bedrooms: number | null
  hudYear: number | 'auto'
  source: 'manual_button' | 'smart_analyze'
}) {
  const { workspace, supabase } = await requireDeal(params.dealId)
  const result = await lookupHudFmrByZip({ zipCode: params.zipCode, bedrooms: params.bedrooms, hudYear: params.hudYear })
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
    source: result.hudYearMode === 'auto' ? 'HUDUSER_AUTO_LATEST' : 'HUDUSER_MANUAL_YEAR',
    source_url: result.sourceUrl,
    raw_response: { ...(result.raw as any), dealflowiq_lookup: { hudYearMode: result.hudYearMode, attemptedYears: result.attemptedYears, entityId: result.entityId, entitySource: result.entitySource, action_source: params.source } } as any,
    fetched_at: new Date().toISOString(),
  }, { onConflict: 'zip_code,hud_year' })

  if (rent) {
    await supabase.from('deals').update({ section8_rent: rent }).eq('organization_id', workspace.organization!.id).eq('id', params.dealId)
  }

  await supabase.from('hud_lookup_events').insert({
    organization_id: workspace.organization!.id,
    deal_id: params.dealId,
    created_by: workspace.user.id,
    zip_code: result.zipCode,
    bedrooms: params.bedrooms,
    hud_year: result.hudYear,
    status: 'success',
    message: rent
      ? `Applied ${rent} HUD/FMR benchmark from HUD year ${result.hudYear}. Entity: ${result.entityId || 'n/a'} (${result.entitySource || 'n/a'}).`
      : `HUD lookup succeeded for HUD year ${result.hudYear}, but no selected bedroom rent was found.`,
    source_url: result.sourceUrl,
  })

  return { rent, result }
}

export async function addMarketRentCompAction(formData: FormData) {
  const dealId = String(formData.get('deal_id') || '').trim()
  if (!dealId) redirect('/deals?error=Missing deal id')

  const { workspace, supabase, property } = await requireDeal(dealId)
  const rawMonthlyRent = numberValue(formData, 'monthly_rent')
  const monthlyRent = rentValue(formData, 'monthly_rent')
  if (rawMonthlyRent === null) redirect(`/deals/${dealId}/rent-intelligence?error=Monthly rent is required`)
  if (monthlyRent === null) invalidRentRedirect(dealId, 'Monthly rent')

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

  if (formData.get('apply_to_deal') === 'on') await refreshMarketRentFromComps(supabase, workspace.organization!.id, dealId)

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
  const rawManualRentOverride = numberValue(formData, 'monthly_rent_override')
  const manualRentOverride = rawManualRentOverride === null ? null : rentValue(formData, 'monthly_rent_override')
  if (rawManualRentOverride !== null && manualRentOverride === null) invalidRentRedirect(dealId, 'Manual rent override')

  let redirectUrl = `/deals/${dealId}/rent-intelligence?saved=zillow`

  try {
    const imported = await importZillowRentalByUrl(sourceUrl)
    const monthlyRent = manualRentOverride ?? imported.monthlyRent
    if (!monthlyRent || !isReasonableMonthlyRent(monthlyRent)) throw new Error(`Zillow import did not produce a realistic monthly rent. Enter a manual rent override between $${MIN_REASONABLE_MONTHLY_RENT.toLocaleString()} and $${MAX_REASONABLE_MONTHLY_RENT.toLocaleString()}.`)

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

    if (error) throw new Error(error.message)
    if (formData.get('apply_to_deal') === 'on') await refreshMarketRentFromComps(supabase, workspace.organization!.id, dealId)

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
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Zillow import failed'
    await supabase.from('audit_logs').insert({
      organization_id: workspace.organization!.id,
      actor_id: workspace.user.id,
      event_type: 'market_rent_comp.zillow_import_failed',
      entity_type: 'deal',
      entity_id: dealId,
      metadata: { source_url: sourceUrl, error: message },
    })
    redirectUrl = `/deals/${dealId}/rent-intelligence?error=${encodeURIComponent(message)}`
  }

  redirect(redirectUrl)
}

export async function applyMarketRentSummaryAction(formData: FormData) {
  const dealId = String(formData.get('deal_id') || '').trim()
  if (!dealId) redirect('/deals?error=Missing deal id')
  const { workspace, supabase } = await requireDeal(dealId)
  const summary = await refreshMarketRentFromComps(supabase, workspace.organization!.id, dealId)
  if (!summary.recommendedRent) redirect(`/deals/${dealId}/rent-intelligence?error=Add at least one valid market rent comp first. DealFlowIQ ignores unrealistic rents and outliers.`)
  revalidatePath(`/deals/${dealId}`)
  redirect(`/deals/${dealId}/rent-intelligence?saved=market_rent`)
}

export async function lookupHudRentAction(formData: FormData) {
  const dealId = String(formData.get('deal_id') || '').trim()
  if (!dealId) redirect('/deals?error=Missing deal id')
  const { workspace, supabase, property } = await requireDeal(dealId)
  const zipCode = text(formData, 'zip_code') || property?.zip_code || ''
  const bedrooms = numberValue(formData, 'bedrooms') ?? property?.bedrooms ?? null
  const hudYearRaw = String(formData.get('hud_year') || 'auto').trim().toLowerCase()
  const hudYear = hudYearRaw && hudYearRaw !== 'auto' ? Number(hudYearRaw) : 'auto'
  const redirectTo = String(formData.get('redirect_to') || `/deals/${dealId}/rent-intelligence`)

  try {
    await applyHudLookupToDeal({ dealId, zipCode, bedrooms, hudYear, source: 'manual_button' })
    revalidatePath(`/deals/${dealId}`)
    revalidatePath(`/deals/${dealId}/rent-intelligence`)
    revalidatePath(`/deals/${dealId}/analyzer`)
    redirect(`${redirectTo}?saved=hud`)
  } catch (error) {
    await supabase.from('hud_lookup_events').insert({
      organization_id: workspace.organization!.id,
      deal_id: dealId,
      created_by: workspace.user.id,
      zip_code: zipCode || 'missing',
      bedrooms,
      hud_year: typeof hudYear === 'number' && Number.isFinite(hudYear) ? hudYear : new Date().getFullYear(),
      status: 'failed',
      message: error instanceof Error ? error.message : 'HUD lookup failed',
    })
    redirect(`${redirectTo}?error=${encodeURIComponent(error instanceof Error ? error.message : 'HUD lookup failed')}`)
  }
}

export async function smartAnalyzeDealAction(formData: FormData) {
  const dealId = String(formData.get('deal_id') || '').trim()
  if (!dealId) redirect('/deals?error=Missing deal id')

  const { workspace, supabase, deal, property } = await requireDeal(dealId)
  const redirectTo = String(formData.get('redirect_to') || `/deals/${dealId}/analyzer`)
  const zipCode = property?.zip_code || ''
  const bedrooms = property?.bedrooms ?? null
  const messages: string[] = []

  try {
    if (!deal.section8_rent && zipCode) {
      const hud = await applyHudLookupToDeal({ dealId, zipCode, bedrooms, hudYear: 'auto', source: 'smart_analyze' })
      if (hud.rent) messages.push('HUD rent updated')
    }
  } catch (error) {
    messages.push(`HUD lookup skipped: ${error instanceof Error ? error.message : 'failed'}`)
  }

  const summary = await refreshMarketRentFromComps(supabase, workspace.organization!.id, dealId)
  if (summary.recommendedRent) messages.push('Market rent updated from comps')

  await supabase.from('audit_logs').insert({
    organization_id: workspace.organization!.id,
    actor_id: workspace.user.id,
    event_type: 'deal.smart_analyze.run',
    entity_type: 'deal',
    entity_id: dealId,
    metadata: { messages },
  })

  revalidatePath(`/deals/${dealId}`)
  revalidatePath(`/deals/${dealId}/rent-intelligence`)
  revalidatePath(`/deals/${dealId}/analyzer`)
  redirect(`${redirectTo}?saved=smart&notice=${encodeURIComponent(messages.join(' · ') || 'Smart analysis refreshed')}`)
}
