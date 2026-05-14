'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { buildCalculationSnapshotPayload, calculateDealUnderwriting } from '@/lib/calculations/underwriting'
import { isReasonableMonthlyRent } from '@/lib/underwriting/rentIntelligence'

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
  const raw = String(formData.get(key) || '').trim()
  if (!raw) return null
  const cleaned = raw.replace(/[$\s]/g, '').replace(/,/g, '')
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function rentValue(formData: FormData, key: string) {
  const value = numberValue(formData, key)
  if (value === null) return null
  return isReasonableMonthlyRent(value) ? value : null
}

function integerValue(formData: FormData, key: string) {
  const value = numberValue(formData, key)
  return value === null ? null : Math.round(value)
}

function statusValue(formData: FormData) {
  const value = String(formData.get('status') || 'draft')
  return VALID_STATUSES.has(value) ? value : 'draft'
}

function capRateBasisValue(formData: FormData) {
  const value = String(formData.get('cap_rate_basis') || 'purchase_price')
  return value === 'arv' || value === 'custom_value' ? value : 'purchase_price'
}

function hasFormValue(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim() !== ''
}

function maybeNumber(formData: FormData, key: string) {
  return hasFormValue(formData, key) ? numberValue(formData, key) : undefined
}

function maybeRent(formData: FormData, key: string) {
  if (!hasFormValue(formData, key)) return undefined
  return rentValue(formData, key)
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
    current_rent: rentValue(formData, 'current_rent'),
    market_rent: rentValue(formData, 'market_rent'),
    section8_rent: rentValue(formData, 'section8_rent'),
    target_rent: rentValue(formData, 'target_rent'),
    taxes_annual: numberValue(formData, 'taxes_annual'),
    insurance_annual: numberValue(formData, 'insurance_annual'),
    hoa_monthly: numberValue(formData, 'hoa_monthly'),
    utilities_monthly: numberValue(formData, 'utilities_monthly'),
    vacancy_percent: numberValue(formData, 'vacancy_percent'),
    management_percent: numberValue(formData, 'management_percent'),
    capex_monthly: numberValue(formData, 'capex_monthly'),
    down_payment_percent: numberValue(formData, 'down_payment_percent'),
    down_payment_amount: numberValue(formData, 'down_payment_amount'),
    loan_amount: numberValue(formData, 'loan_amount'),
    interest_rate_percent: numberValue(formData, 'interest_rate_percent'),
    loan_term_years: integerValue(formData, 'loan_term_years'),
    loan_term_months: integerValue(formData, 'loan_term_months'),
    dscr_min_threshold: numberValue(formData, 'dscr_min_threshold'),
    cap_rate_basis: capRateBasisValue(formData),
    cap_rate_custom_value: numberValue(formData, 'cap_rate_custom_value'),
    closing_costs: numberValue(formData, 'closing_costs'),
    selling_costs_percent: numberValue(formData, 'selling_costs_percent'),
    holding_costs_monthly: numberValue(formData, 'holding_costs_monthly'),
    mao_percentage: numberValue(formData, 'mao_percentage'),
    desired_wholesale_fee: numberValue(formData, 'desired_wholesale_fee'),
    refinance_ltv_percent: numberValue(formData, 'refinance_ltv_percent'),
    rent_growth_percent: numberValue(formData, 'rent_growth_percent'),
    expense_growth_percent: numberValue(formData, 'expense_growth_percent'),
    exit_cap_rate_percent: numberValue(formData, 'exit_cap_rate_percent'),
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


export async function quickUpdateDealAssumptionsAction(formData: FormData) {
  const dealId = String(formData.get('deal_id') || '').trim()
  const redirectTo = String(formData.get('redirect_to') || `/deals/${dealId}`)
  if (!dealId) redirect('/deals?error=Missing deal id')

  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing workspace organization')

  const payload: Record<string, unknown> = {}
  const keys = [
    'purchase_price',
    'arv',
    'rehab_estimate',
    'current_rent',
    'market_rent',
    'section8_rent',
    'target_rent',
    'taxes_annual',
    'insurance_annual',
    'hoa_monthly',
    'utilities_monthly',
    'capex_monthly',
    'down_payment_percent',
    'down_payment_amount',
    'loan_amount',
    'interest_rate_percent',
    'loan_term_months',
    'dscr_min_threshold',
    'vacancy_percent',
    'management_percent',
    'closing_costs',
    'selling_costs_percent',
    'holding_costs_monthly',
    'mao_percentage',
    'desired_wholesale_fee',
    'refinance_ltv_percent',
    'rent_growth_percent',
    'expense_growth_percent',
    'exit_cap_rate_percent',
  ]

  for (const key of keys) {
    if (!hasFormValue(formData, key)) continue
    const value = key.endsWith('_rent') ? maybeRent(formData, key) : maybeNumber(formData, key)
    if (value === null) redirect(`${redirectTo}?error=${encodeURIComponent(`${key.replaceAll('_', ' ')} must be a realistic value.`)}`)
    if (value !== undefined) payload[key] = value
  }

  if (hasFormValue(formData, 'cap_rate_basis')) payload.cap_rate_basis = capRateBasisValue(formData)
  if (hasFormValue(formData, 'cap_rate_custom_value')) payload.cap_rate_custom_value = numberValue(formData, 'cap_rate_custom_value')

  if (!Object.keys(payload).length) redirect(`${redirectTo}?error=${encodeURIComponent('Enter at least one value to update.')}`)

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('deals')
    .update(payload)
    .eq('id', dealId)
    .eq('organization_id', workspace.organization.id)

  if (error) redirect(`${redirectTo}?error=${encodeURIComponent(error.message)}`)

  await supabase.from('audit_logs').insert({
    organization_id: workspace.organization.id,
    actor_id: workspace.user.id,
    event_type: 'deal.quick_assumptions.updated',
    entity_type: 'deal',
    entity_id: dealId,
    metadata: { fields: Object.keys(payload) },
  })

  revalidatePath(`/deals/${dealId}`)
  revalidatePath(`/deals/${dealId}/analyzer`)
  redirect(`${redirectTo}?saved=assumptions`)
}

export async function createCalculationSnapshotAction(formData: FormData) {
  const dealId = String(formData.get('deal_id') || '').trim()
  const snapshotName = String(formData.get('snapshot_name') || '').trim() || 'Underwriting snapshot'
  const redirectTo = String(formData.get('redirect_to') || `/deals/${dealId}/analyzer`)

  if (!dealId) redirect('/deals?error=Missing deal id')

  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing workspace organization')

  const supabase = await createSupabaseServerClient()
  const { data: deal, error: dealError } = await supabase
    .from('deals')
    .select('*, properties(*)')
    .eq('id', dealId)
    .eq('organization_id', workspace.organization.id)
    .maybeSingle()

  if (dealError || !deal) {
    redirect(`/deals/${dealId}/analyzer?error=${encodeURIComponent(dealError?.message || 'Deal not found')}`)
  }

  const property = Array.isArray((deal as any).properties) ? (deal as any).properties[0] : (deal as any).properties
  const summary = calculateDealUnderwriting(deal as any, property as any)
  const snapshot = buildCalculationSnapshotPayload(summary)

  const { error: snapshotError } = await supabase.from('deal_calculation_snapshots').insert({
    organization_id: workspace.organization.id,
    deal_id: dealId,
    created_by: workspace.user.id,
    snapshot_name: snapshotName,
    formula_version: snapshot.formula_version,
    assumptions: snapshot.assumptions,
    results: snapshot.results,
    formula_sources: snapshot.formula_sources,
  })

  if (snapshotError) {
    redirect(`/deals/${dealId}/analyzer?error=${encodeURIComponent(snapshotError.message)}`)
  }

  await supabase.from('audit_logs').insert({
    organization_id: workspace.organization.id,
    actor_id: workspace.user.id,
    event_type: 'deal.calculation_snapshot.created',
    entity_type: 'deal',
    entity_id: dealId,
    metadata: { formula_version: snapshot.formula_version, snapshot_name: snapshotName },
  })

  revalidatePath(`/deals/${dealId}`)
  revalidatePath(`/deals/${dealId}/analyzer`)
  redirect(redirectTo.startsWith('/deals/') ? `${redirectTo}?snapshot=saved` : `/deals/${dealId}/analyzer?snapshot=saved`)
}

export async function deleteDealAction(formData: FormData) {
  const dealId = String(formData.get('deal_id') || '').trim()
  if (!dealId) redirect('/deals?error=Missing deal id')

  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing workspace organization')

  const supabase = await createSupabaseServerClient()
  const { data: deal, error: readError } = await supabase
    .from('deals')
    .select('id, title, created_by, organization_id')
    .eq('id', dealId)
    .eq('organization_id', workspace.organization.id)
    .maybeSingle()

  if (readError || !deal) redirect(`/deals?error=${encodeURIComponent(readError?.message || 'Deal not found')}`)

  const { error } = await supabase
    .from('deals')
    .delete()
    .eq('id', dealId)
    .eq('organization_id', workspace.organization.id)

  if (error) redirect(`/deals/${dealId}?error=${encodeURIComponent(error.message)}`)

  await supabase.from('audit_logs').insert({
    organization_id: workspace.organization.id,
    actor_id: workspace.user.id,
    event_type: 'deal.deleted',
    entity_type: 'deal',
    entity_id: dealId,
    metadata: { title: (deal as any).title },
  })

  revalidatePath('/deals')
  redirect('/deals?saved=deleted')
}
