'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { assertNotPaymentRequired, hasOrganizationRole, MANAGEMENT_ROLES } from '@/lib/auth/access'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { buildCalculationSnapshotPayload, calculateDealUnderwriting } from '@/lib/calculations/underwriting'
import { isReasonableMonthlyRent } from '@/lib/underwriting/rentIntelligence'
import { recordAuditEvent } from '@/lib/audit'
import { ARCHIVED_DEAL_STATUS, DEAL_STATUSES, duplicateDealPayload, duplicatePropertyPayload } from '@/lib/deals/lifecycle'
import { firstRow, type Row } from '@/lib/types/rows'

const VALID_STATUSES = new Set<string>(DEAL_STATUSES)

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


function urlListValue(formData: FormData, key: string) {
  const raw = String(formData.get(key) || '').trim()
  if (!raw) return []
  return raw
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter((item) => item.startsWith('http://') || item.startsWith('https://'))
    .slice(0, 12)
}


function visibilityValue(formData: FormData) {
  const value = String(formData.get('visibility') || 'private')
  return value === 'team' || value === 'community' || value === 'public' ? value : 'private'
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

function uploadedDealFiles(formData: FormData) {
  return formData
    .getAll('deal_files')
    .filter((value): value is File => typeof File !== 'undefined' && value instanceof File && value.size > 0)
}

const DEAL_FILE_BUCKET = 'deal-files'
const MAX_DEAL_FILE_SIZE = 15 * 1024 * 1024
const MAX_DEAL_FILES_PER_SUBMIT = 12
const ALLOWED_DEAL_FILE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])

function safeStorageFileName(name: string) {
  const cleaned = String(name || 'file')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120)
  return cleaned || 'file'
}

function fileKindFor(mimeType: string) {
  return mimeType === 'application/pdf' ? 'pdf' : 'image'
}

async function uploadDealFiles(params: {
  formData: FormData
  organizationId: string
  dealId: string
  userId: string
}) {
  const files = uploadedDealFiles(params.formData).slice(0, MAX_DEAL_FILES_PER_SUBMIT)
  if (!files.length) return []

  const admin = createSupabaseAdminClient()
  const uploaded: Array<{ path: string; fileKind: string; mimeType: string; fileName: string; size: number }> = []

  for (const [index, file] of files.entries()) {
    const mimeType = String(file.type || '').toLowerCase()
    if (!ALLOWED_DEAL_FILE_TYPES.has(mimeType)) {
      throw new Error(`${file.name || 'File'} is not supported. Upload JPG, PNG, WebP or PDF files.`)
    }
    if (file.size > MAX_DEAL_FILE_SIZE) {
      throw new Error(`${file.name || 'File'} is too large. Max file size is 15 MB.`)
    }

    const fileName = safeStorageFileName(file.name)
    const storagePath = `${params.organizationId}/${params.dealId}/${Date.now()}-${index}-${crypto.randomUUID()}-${fileName}`
    const buffer = Buffer.from(await file.arrayBuffer())
    const { error: uploadError } = await admin.storage.from(DEAL_FILE_BUCKET).upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: false,
    })
    if (uploadError) throw new Error(uploadError.message)

    uploaded.push({ path: storagePath, fileKind: fileKindFor(mimeType), mimeType, fileName, size: file.size })
  }

  if (uploaded.length) {
    const { error } = await admin.from('deal_files').insert(uploaded.map((file, index) => ({
      organization_id: params.organizationId,
      deal_id: params.dealId,
      uploaded_by: params.userId,
      storage_bucket: DEAL_FILE_BUCKET,
      storage_path: file.path,
      file_name: file.fileName,
      mime_type: file.mimeType,
      file_size_bytes: file.size,
      file_kind: file.fileKind,
      sort_order: index,
    })))
    if (error) throw new Error(error.message)
  }

  return uploaded
}


function buildDealPayload(formData: FormData) {
  return {
    title: text(formData, 'title') || 'Untitled Deal',
    status: statusValue(formData),
    source_url: text(formData, 'source_url'),
    source_platform: text(formData, 'source_platform'),
    primary_image_url: text(formData, 'primary_image_url'),
    image_urls: urlListValue(formData, 'image_urls'),
    visibility: visibilityValue(formData),
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
    flip_holding_months: integerValue(formData, 'flip_holding_months'),
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
  assertNotPaymentRequired(workspace)

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
    redirect(`/deals/new?error=DEAL_ACTION_FAILED`)
  }

  const { error: propertyError } = await supabase.from('properties').insert({
    ...buildPropertyPayload(formData),
    organization_id: workspace.organization.id,
    deal_id: deal.id,
  })

  if (propertyError) {
    redirect(`/deals/${deal.id}/edit?error=DEAL_ACTION_FAILED`)
  }

  try {
    await uploadDealFiles({ formData, organizationId: workspace.organization.id, dealId: deal.id, userId: workspace.user.id })
  } catch {
    redirect(`/deals/${deal.id}/edit?error=DEAL_ACTION_FAILED`)
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
    redirect(`/deals/${dealId}/edit?error=DEAL_ACTION_FAILED`)
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
    redirect(`/deals/${dealId}/edit?error=DEAL_ACTION_FAILED`)
  }

  try {
    await uploadDealFiles({ formData, organizationId: workspace.organization.id, dealId, userId: workspace.user.id })
  } catch {
    redirect(`/deals/${dealId}/edit?error=DEAL_ACTION_FAILED`)
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
    'flip_holding_months',
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
    if (value === null) redirect(`${redirectTo}?error=DEAL_ACTION_FAILED`)
    if (value !== undefined) payload[key] = value
  }

  if (hasFormValue(formData, 'cap_rate_basis')) payload.cap_rate_basis = capRateBasisValue(formData)
  if (hasFormValue(formData, 'cap_rate_custom_value')) payload.cap_rate_custom_value = numberValue(formData, 'cap_rate_custom_value')

  if (!Object.keys(payload).length) redirect(`${redirectTo}?error=DEAL_ACTION_FAILED`)

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('deals')
    .update(payload)
    .eq('id', dealId)
    .eq('organization_id', workspace.organization.id)

  if (error) redirect(`${redirectTo}?error=DEAL_ACTION_FAILED`)

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
    redirect(`/deals/${dealId}/analyzer?error=DEAL_ACTION_FAILED`)
  }

  const dealRow = deal as Row
  const property = firstRow(dealRow.properties)
  const summary = calculateDealUnderwriting(dealRow, property)
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
    redirect(`/deals/${dealId}/analyzer?error=DEAL_ACTION_FAILED`)
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

/**
 * Restores the inputs captured in a calculation snapshot back onto the deal.
 * Snapshots stay immutable — this copies their stored assumptions/results
 * into the live deal fields and lets the engine recalculate from there.
 */
export async function restoreCalculationSnapshotAction(formData: FormData) {
  const dealId = String(formData.get('deal_id') || '').trim()
  const snapshotId = String(formData.get('snapshot_id') || '').trim()
  if (!dealId || !snapshotId) redirect('/deals?error=Missing deal or snapshot id')

  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing workspace organization')

  const supabase = await createSupabaseServerClient()
  const { data: snapshot, error: snapshotError } = await supabase
    .from('deal_calculation_snapshots')
    .select('id, snapshot_name, assumptions, results')
    .eq('id', snapshotId)
    .eq('deal_id', dealId)
    .eq('organization_id', workspace.organization.id)
    .maybeSingle()
  if (snapshotError || !snapshot) {
    redirect(`/deals/${dealId}/analyzer?error=DEAL_ACTION_FAILED`)
  }

  const snapshotRow = snapshot as Row
  const assumptions = firstRow(snapshotRow.assumptions) || {}
  const results = firstRow(snapshotRow.results) || {}
  const scenarios = firstRow(results.scenarios) || {}
  const mortgage = firstRow(assumptions.mortgage) || {}
  const operating = firstRow(assumptions.operating) || {}
  const capRate = firstRow(assumptions.capRate) || {}
  const dscr = firstRow(assumptions.dscr) || {}
  const wholesale = firstRow(assumptions.wholesale) || {}
  const flip = firstRow(assumptions.flip) || {}
  const brrrr = firstRow(assumptions.brrrr) || {}
  const projection = firstRow(assumptions.projection) || {}

  const numberOrNull = (value: unknown) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }
  const scenarioRent = (key: string) => numberOrNull(firstRow((scenarios as Row)[key])?.monthlyRent)

  const update: Record<string, unknown> = {
    purchase_price: numberOrNull(results.purchasePrice),
    arv: numberOrNull(results.arv),
    rehab_estimate: numberOrNull(results.rehabEstimate),
    current_rent: scenarioRent('current'),
    market_rent: scenarioRent('market'),
    section8_rent: scenarioRent('section8'),
    target_rent: scenarioRent('target'),
    vacancy_percent: numberOrNull(operating.vacancyPercent),
    management_percent: numberOrNull(operating.managementPercent),
    interest_rate_percent: numberOrNull(mortgage.annualInterestRatePercent),
    loan_term_months: numberOrNull(mortgage.monthlyPayments),
    dscr_min_threshold: numberOrNull(dscr.minimumThreshold),
    cap_rate_basis: ['purchase_price', 'arv', 'custom_value'].includes(String(capRate.basis)) ? capRate.basis : 'purchase_price',
    mao_percentage: numberOrNull(wholesale.maoPercentage),
    desired_wholesale_fee: numberOrNull(wholesale.desiredWholesaleFee),
    selling_costs_percent: numberOrNull(flip.sellingCostsPercent),
    holding_costs_monthly: numberOrNull(flip.holdingCostsMonthly),
    flip_holding_months: numberOrNull(flip.holdingMonths),
    refinance_ltv_percent: numberOrNull(brrrr.refinanceLtvPercent),
    rent_growth_percent: numberOrNull(projection.rentGrowthPercent),
    expense_growth_percent: numberOrNull(projection.expenseGrowthPercent),
    exit_cap_rate_percent: numberOrNull(projection.exitCapRatePercent),
  }
  // Never wipe fields the snapshot has no value for.
  for (const key of Object.keys(update)) {
    if (update[key] === null || update[key] === undefined) delete update[key]
  }

  const { error: updateError } = await supabase
    .from('deals')
    .update(update)
    .eq('id', dealId)
    .eq('organization_id', workspace.organization.id)
  if (updateError) {
    redirect(`/deals/${dealId}/analyzer?error=DEAL_ACTION_FAILED`)
  }

  await supabase.from('audit_logs').insert({
    organization_id: workspace.organization.id,
    actor_id: workspace.user.id,
    event_type: 'deal.calculation_snapshot.restored',
    entity_type: 'deal',
    entity_id: dealId,
    metadata: { snapshot_id: snapshotId, snapshot_name: snapshotRow.snapshot_name, restored_fields: Object.keys(update) },
  })

  revalidatePath(`/deals/${dealId}`)
  revalidatePath(`/deals/${dealId}/analyzer`)
  redirect(`/deals/${dealId}/analyzer?notice=${encodeURIComponent(`Snapshot "${snapshotRow.snapshot_name || 'Underwriting snapshot'}" restored onto the deal.`)}`)
}

export async function duplicateDealAction(formData: FormData) {
  const dealId = String(formData.get('deal_id') || '').trim()
  if (!dealId) redirect('/deals?error=Missing deal id')

  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing workspace organization')
  assertNotPaymentRequired(workspace)

  const supabase = await createSupabaseServerClient()
  const { data: sourceDeal, error: readError } = await supabase
    .from('deals')
    .select('*, properties(*)')
    .eq('id', dealId)
    .eq('organization_id', workspace.organization.id)
    .maybeSingle()

  if (readError || !sourceDeal) {
    redirect(`/deals?error=DEAL_ACTION_FAILED`)
  }

  const sourceRow = sourceDeal as Row
  const sourceProperty = firstRow(sourceRow.properties)

  const { data: newDeal, error: insertError } = await supabase
    .from('deals')
    .insert(duplicateDealPayload(sourceRow, { organizationId: workspace.organization.id, userId: workspace.user.id }))
    .select('id')
    .single()

  if (insertError || !newDeal) {
    redirect(`/deals/${dealId}?error=DEAL_ACTION_FAILED`)
  }

  if (sourceProperty) {
    const { error: propertyError } = await supabase
      .from('properties')
      .insert(duplicatePropertyPayload(sourceProperty, { organizationId: workspace.organization.id, dealId: newDeal.id }))
    if (propertyError) {
      redirect(`/deals/${newDeal.id}/edit?error=DEAL_ACTION_FAILED`)
    }
  }

  await recordAuditEvent({
    organizationId: workspace.organization.id,
    actorId: workspace.user.id,
    eventType: 'deal.duplicated',
    entityType: 'deal',
    entityId: newDeal.id,
    metadata: { source_deal_id: dealId, title: sourceRow.title },
  })

  revalidatePath('/deals')
  redirect(`/deals/${newDeal.id}?saved=duplicated`)
}

export async function archiveDealAction(formData: FormData) {
  const dealId = String(formData.get('deal_id') || '').trim()
  if (!dealId) redirect('/deals?error=Missing deal id')

  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing workspace organization')

  const supabase = await createSupabaseServerClient()
  const { data: deal, error: readError } = await supabase
    .from('deals')
    .select('id, title, status')
    .eq('id', dealId)
    .eq('organization_id', workspace.organization.id)
    .maybeSingle()

  if (readError || !deal) redirect(`/deals?error=DEAL_ACTION_FAILED`)

  const { error } = await supabase
    .from('deals')
    .update({ status: ARCHIVED_DEAL_STATUS })
    .eq('id', dealId)
    .eq('organization_id', workspace.organization.id)

  if (error) redirect(`/deals/${dealId}?error=DEAL_ACTION_FAILED`)

  await recordAuditEvent({
    organizationId: workspace.organization.id,
    actorId: workspace.user.id,
    eventType: 'deal.archived',
    entityType: 'deal',
    entityId: dealId,
    metadata: { title: (deal as Row).title, previous_status: (deal as Row).status, archived_status: ARCHIVED_DEAL_STATUS },
  })

  revalidatePath('/deals')
  revalidatePath(`/deals/${dealId}`)
  redirect(`/deals/${dealId}?saved=archived`)
}

export async function deleteDealFileAction(formData: FormData) {
  const dealId = String(formData.get('deal_id') || '').trim()
  const fileId = String(formData.get('file_id') || '').trim()
  const requestedRedirect = String(formData.get('redirect_to') || '').trim()
  const redirectTo = requestedRedirect.startsWith('/deals/') ? requestedRedirect : `/deals/${dealId}`
  if (!dealId || !fileId) redirect('/deals?error=Missing deal or file id')

  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing workspace organization')

  const supabase = await createSupabaseServerClient()
  const { data: file, error: readError } = await supabase
    .from('deal_files')
    .select('id, deal_id, organization_id, uploaded_by, storage_bucket, storage_path, file_name')
    .eq('id', fileId)
    .eq('deal_id', dealId)
    .eq('organization_id', workspace.organization.id)
    .maybeSingle()

  if (readError || !file) {
    redirect(`${redirectTo}?error=DEAL_ACTION_FAILED`)
  }

  const fileRow = file as Row
  const isUploader = fileRow.uploaded_by === workspace.user.id
  if (!isUploader && !hasOrganizationRole(workspace, MANAGEMENT_ROLES)) {
    redirect(`${redirectTo}?error=DEAL_ACTION_FAILED`)
  }

  const admin = createSupabaseAdminClient()
  const bucket = String(fileRow.storage_bucket || DEAL_FILE_BUCKET)
  const { error: storageError } = await admin.storage.from(bucket).remove([String(fileRow.storage_path)])
  if (storageError) {
    redirect(`${redirectTo}?error=DEAL_ACTION_FAILED`)
  }

  const { error: deleteError } = await admin
    .from('deal_files')
    .delete()
    .eq('id', fileId)
    .eq('organization_id', workspace.organization.id)
  if (deleteError) {
    redirect(`${redirectTo}?error=DEAL_ACTION_FAILED`)
  }

  await recordAuditEvent({
    organizationId: workspace.organization.id,
    actorId: workspace.user.id,
    eventType: 'deal_file.deleted',
    entityType: 'deal_file',
    entityId: fileId,
    metadata: { deal_id: dealId, file_name: fileRow.file_name, storage_path: fileRow.storage_path },
  })

  revalidatePath(`/deals/${dealId}`)
  revalidatePath(`/deals/${dealId}/edit`)
  redirect(`${redirectTo}?saved=file_deleted`)
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

  if (readError || !deal) redirect(`/deals?error=DEAL_ACTION_FAILED`)

  const { error } = await supabase
    .from('deals')
    .delete()
    .eq('id', dealId)
    .eq('organization_id', workspace.organization.id)

  if (error) redirect(`/deals/${dealId}?error=DEAL_ACTION_FAILED`)

  await supabase.from('audit_logs').insert({
    organization_id: workspace.organization.id,
    actor_id: workspace.user.id,
    event_type: 'deal.deleted',
    entity_type: 'deal',
    entity_id: dealId,
    metadata: { title: (deal as Row).title },
  })

  revalidatePath('/deals')
  redirect('/deals?saved=deleted')
}
