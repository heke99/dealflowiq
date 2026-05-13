'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const VALID_STATUSES = new Set([
  'draft',
  'imported',
  'needs_review',
  'analyzed',
  'approved',
  'rejected',
  'under_contract',
  'sent_to_buyers',
  'offers_received',
  'assigned',
  'closed',
  'dead',
])

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

function integerValue(formData: FormData, key: string) {
  const value = numberValue(formData, key)
  return value === null ? null : Math.round(value)
}

function statusValue(formData: FormData) {
  const value = String(formData.get('status') || 'draft')
  return VALID_STATUSES.has(value) ? value : 'draft'
}

function buildDealPayload(formData: FormData) {
  return {
    title: text(formData, 'title') || 'Untitled Deal',
    status: statusValue(formData),
    source_url: text(formData, 'source_url'),
    source_platform: text(formData, 'source_platform'),
    property_type: text(formData, 'property_type'),
    asking_price: numberValue(formData, 'asking_price'),
    contract_price: numberValue(formData, 'contract_price'),
    purchase_price: numberValue(formData, 'purchase_price'),
    arv: numberValue(formData, 'arv'),
    rehab_estimate: numberValue(formData, 'rehab_estimate'),
    current_rent: numberValue(formData, 'current_rent'),
    market_rent: numberValue(formData, 'market_rent'),
    section8_rent: numberValue(formData, 'section8_rent'),
    target_rent: numberValue(formData, 'target_rent'),
    taxes_annual: numberValue(formData, 'taxes_annual'),
    insurance_annual: numberValue(formData, 'insurance_annual'),
    hoa_monthly: numberValue(formData, 'hoa_monthly'),
    utilities_monthly: numberValue(formData, 'utilities_monthly'),
    vacancy_percent: numberValue(formData, 'vacancy_percent'),
    management_percent: numberValue(formData, 'management_percent'),
    capex_monthly: numberValue(formData, 'capex_monthly'),
    notes: text(formData, 'notes'),
  }
}

function buildPropertyPayload(formData: FormData) {
  return {
    address: text(formData, 'address'),
    city: text(formData, 'city'),
    state: text(formData, 'state'),
    zip_code: text(formData, 'zip_code'),
    county: text(formData, 'county'),
    bedrooms: numberValue(formData, 'bedrooms'),
    bathrooms: numberValue(formData, 'bathrooms'),
    square_feet: integerValue(formData, 'square_feet'),
    lot_size: text(formData, 'lot_size'),
    year_built: integerValue(formData, 'year_built'),
    number_of_units: integerValue(formData, 'number_of_units') || 1,
    occupancy_status: text(formData, 'occupancy_status'),
  }
}

export async function createDealAction(formData: FormData) {
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing workspace organization')

  const supabase = await createSupabaseServerClient()
  const dealPayload = buildDealPayload(formData)

  const { data: deal, error: dealError } = await supabase
    .from('deals')
    .insert({
      ...dealPayload,
      organization_id: workspace.organization.id,
      created_by: workspace.user.id,
      assigned_user_id: workspace.user.id,
    })
    .select('id')
    .single()

  if (dealError || !deal) {
    redirect(`/deals/new?error=${encodeURIComponent(dealError?.message || 'Could not create deal')}`)
  }

  const { error: propertyError } = await supabase.from('properties').insert({
    ...buildPropertyPayload(formData),
    organization_id: workspace.organization.id,
    deal_id: deal.id,
  })

  if (propertyError) {
    redirect(`/deals/${deal.id}/edit?error=${encodeURIComponent(propertyError.message)}`)
  }

  await supabase.from('audit_logs').insert({
    organization_id: workspace.organization.id,
    actor_id: workspace.user.id,
    event_type: 'deal.created',
    entity_type: 'deal',
    entity_id: deal.id,
    metadata: { source: 'createDealAction' },
  })

  revalidatePath('/deals')
  redirect(`/deals/${deal.id}`)
}

export async function updateDealAction(formData: FormData) {
  const dealId = String(formData.get('deal_id') || '').trim()
  if (!dealId) redirect('/deals?error=Missing deal id')

  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing workspace organization')

  const supabase = await createSupabaseServerClient()
  const { error: dealError } = await supabase
    .from('deals')
    .update(buildDealPayload(formData))
    .eq('id', dealId)
    .eq('organization_id', workspace.organization.id)

  if (dealError) {
    redirect(`/deals/${dealId}/edit?error=${encodeURIComponent(dealError.message)}`)
  }

  const propertyPayload = {
    ...buildPropertyPayload(formData),
    organization_id: workspace.organization.id,
    deal_id: dealId,
  }

  const { error: propertyError } = await supabase
    .from('properties')
    .upsert(propertyPayload, { onConflict: 'deal_id' })

  if (propertyError) {
    redirect(`/deals/${dealId}/edit?error=${encodeURIComponent(propertyError.message)}`)
  }

  await supabase.from('audit_logs').insert({
    organization_id: workspace.organization.id,
    actor_id: workspace.user.id,
    event_type: 'deal.updated',
    entity_type: 'deal',
    entity_id: dealId,
    metadata: { source: 'updateDealAction' },
  })

  revalidatePath('/deals')
  revalidatePath(`/deals/${dealId}`)
  redirect(`/deals/${dealId}`)
}
