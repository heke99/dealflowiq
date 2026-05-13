import { createSupabaseServerClient } from '@/lib/supabase/server'

export type UnderwritingDefaults = {
  vacancy_percent: number
  management_percent: number
  capex_monthly: number
  down_payment_percent: number
  interest_rate_percent: number
  loan_term_months: number
  dscr_min_threshold: number
  cap_rate_basis: 'purchase_price' | 'arv' | 'custom_value'
  mao_percentage: number
  desired_wholesale_fee: number
  selling_costs_percent: number
  holding_costs_monthly: number
  refinance_ltv_percent: number
  rent_growth_percent: number
  expense_growth_percent: number
  exit_cap_rate_percent: number
}

export const DEFAULT_UNDERWRITING_ASSUMPTIONS: UnderwritingDefaults = {
  vacancy_percent: 5,
  management_percent: 8,
  capex_monthly: 0,
  down_payment_percent: 20,
  interest_rate_percent: 7,
  loan_term_months: 360,
  dscr_min_threshold: 1.2,
  cap_rate_basis: 'purchase_price',
  mao_percentage: 70,
  desired_wholesale_fee: 10000,
  selling_costs_percent: 8,
  holding_costs_monthly: 0,
  refinance_ltv_percent: 75,
  rent_growth_percent: 3,
  expense_growth_percent: 3,
  exit_cap_rate_percent: 7,
}

function numberOrDefault(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function capBasis(value: unknown): UnderwritingDefaults['cap_rate_basis'] {
  return value === 'arv' || value === 'custom_value' ? value : 'purchase_price'
}

export function normalizeUnderwritingDefaults(row: Record<string, unknown> | null | undefined): UnderwritingDefaults {
  return {
    vacancy_percent: numberOrDefault(row?.vacancy_percent, DEFAULT_UNDERWRITING_ASSUMPTIONS.vacancy_percent),
    management_percent: numberOrDefault(row?.management_percent, DEFAULT_UNDERWRITING_ASSUMPTIONS.management_percent),
    capex_monthly: numberOrDefault(row?.capex_monthly, DEFAULT_UNDERWRITING_ASSUMPTIONS.capex_monthly),
    down_payment_percent: numberOrDefault(row?.down_payment_percent, DEFAULT_UNDERWRITING_ASSUMPTIONS.down_payment_percent),
    interest_rate_percent: numberOrDefault(row?.interest_rate_percent, DEFAULT_UNDERWRITING_ASSUMPTIONS.interest_rate_percent),
    loan_term_months: Math.round(numberOrDefault(row?.loan_term_months, DEFAULT_UNDERWRITING_ASSUMPTIONS.loan_term_months)),
    dscr_min_threshold: numberOrDefault(row?.dscr_min_threshold, DEFAULT_UNDERWRITING_ASSUMPTIONS.dscr_min_threshold),
    cap_rate_basis: capBasis(row?.cap_rate_basis),
    mao_percentage: numberOrDefault(row?.mao_percentage, DEFAULT_UNDERWRITING_ASSUMPTIONS.mao_percentage),
    desired_wholesale_fee: numberOrDefault(row?.desired_wholesale_fee, DEFAULT_UNDERWRITING_ASSUMPTIONS.desired_wholesale_fee),
    selling_costs_percent: numberOrDefault(row?.selling_costs_percent, DEFAULT_UNDERWRITING_ASSUMPTIONS.selling_costs_percent),
    holding_costs_monthly: numberOrDefault(row?.holding_costs_monthly, DEFAULT_UNDERWRITING_ASSUMPTIONS.holding_costs_monthly),
    refinance_ltv_percent: numberOrDefault(row?.refinance_ltv_percent, DEFAULT_UNDERWRITING_ASSUMPTIONS.refinance_ltv_percent),
    rent_growth_percent: numberOrDefault(row?.rent_growth_percent, DEFAULT_UNDERWRITING_ASSUMPTIONS.rent_growth_percent),
    expense_growth_percent: numberOrDefault(row?.expense_growth_percent, DEFAULT_UNDERWRITING_ASSUMPTIONS.expense_growth_percent),
    exit_cap_rate_percent: numberOrDefault(row?.exit_cap_rate_percent, DEFAULT_UNDERWRITING_ASSUMPTIONS.exit_cap_rate_percent),
  }
}

export async function getOrganizationUnderwritingDefaults(organizationId?: string | null): Promise<UnderwritingDefaults> {
  if (!organizationId) return DEFAULT_UNDERWRITING_ASSUMPTIONS
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('organization_underwriting_defaults')
    .select('*')
    .eq('organization_id', organizationId)
    .maybeSingle()

  return normalizeUnderwritingDefaults(data as Record<string, unknown> | null)
}
