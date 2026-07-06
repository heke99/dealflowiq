'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { hasOrganizationRole, MANAGEMENT_ROLES } from '@/lib/auth/access'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { recordAuditEvent } from '@/lib/audit'
import { DEFAULT_UNDERWRITING_ASSUMPTIONS, type UnderwritingDefaults } from '@/lib/underwriting/defaults'

function numberField(formData: FormData, key: keyof UnderwritingDefaults, fallback: number, options?: { min?: number; max?: number; round?: boolean }) {
  const raw = String(formData.get(key) || '').trim().replace(/[$,\s]/g, '')
  const parsed = Number(raw)
  let value = raw && Number.isFinite(parsed) ? parsed : fallback
  if (options?.min !== undefined) value = Math.max(options.min, value)
  if (options?.max !== undefined) value = Math.min(options.max, value)
  return options?.round ? Math.round(value) : value
}

export async function saveUnderwritingDefaultsAction(formData: FormData) {
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  if (!hasOrganizationRole(workspace, MANAGEMENT_ROLES)) {
    redirect('/settings/underwriting?error=Only workspace owners and admins can change underwriting defaults')
  }

  const d = DEFAULT_UNDERWRITING_ASSUMPTIONS
  const capBasisRaw = String(formData.get('cap_rate_basis') || 'purchase_price')
  const payload = {
    organization_id: workspace.organization.id,
    vacancy_percent: numberField(formData, 'vacancy_percent', d.vacancy_percent, { min: 0, max: 100 }),
    management_percent: numberField(formData, 'management_percent', d.management_percent, { min: 0, max: 100 }),
    capex_monthly: numberField(formData, 'capex_monthly', d.capex_monthly, { min: 0 }),
    down_payment_percent: numberField(formData, 'down_payment_percent', d.down_payment_percent, { min: 0, max: 100 }),
    interest_rate_percent: numberField(formData, 'interest_rate_percent', d.interest_rate_percent, { min: 0, max: 100 }),
    loan_term_months: numberField(formData, 'loan_term_months', d.loan_term_months, { min: 12, max: 600, round: true }),
    dscr_min_threshold: numberField(formData, 'dscr_min_threshold', d.dscr_min_threshold, { min: 0, max: 10 }),
    cap_rate_basis: ['purchase_price', 'arv', 'custom_value'].includes(capBasisRaw) ? capBasisRaw : 'purchase_price',
    mao_percentage: numberField(formData, 'mao_percentage', d.mao_percentage, { min: 0, max: 100 }),
    desired_wholesale_fee: numberField(formData, 'desired_wholesale_fee', d.desired_wholesale_fee, { min: 0 }),
    selling_costs_percent: numberField(formData, 'selling_costs_percent', d.selling_costs_percent, { min: 0, max: 100 }),
    holding_costs_monthly: numberField(formData, 'holding_costs_monthly', d.holding_costs_monthly, { min: 0 }),
    refinance_ltv_percent: numberField(formData, 'refinance_ltv_percent', d.refinance_ltv_percent, { min: 0, max: 100 }),
    rent_growth_percent: numberField(formData, 'rent_growth_percent', d.rent_growth_percent, { min: 0, max: 50 }),
    expense_growth_percent: numberField(formData, 'expense_growth_percent', d.expense_growth_percent, { min: 0, max: 50 }),
    exit_cap_rate_percent: numberField(formData, 'exit_cap_rate_percent', d.exit_cap_rate_percent, { min: 0, max: 50 }),
    updated_at: new Date().toISOString(),
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('organization_underwriting_defaults')
    .upsert(payload, { onConflict: 'organization_id' })
  if (error) redirect(`/settings/underwriting?error=${encodeURIComponent(error.message)}`)

  await recordAuditEvent({
    organizationId: workspace.organization.id,
    actorId: workspace.user.id,
    eventType: 'underwriting_defaults.updated',
    entityType: 'organization_underwriting_defaults',
    metadata: payload,
  })

  revalidatePath('/settings/underwriting')
  revalidatePath('/deals/new')
  redirect('/settings/underwriting?saved=1')
}
