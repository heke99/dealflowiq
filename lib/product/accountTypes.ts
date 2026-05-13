export const ACCOUNT_TYPES = [
  'solo_investor',
  'wholesaler',
  'landlord',
  'section_8_landlord',
  'brrrr_investor',
  'fix_and_flip_investor',
  'community_guru_owner',
  'team_company',
] as const

export type AccountType = (typeof ACCOUNT_TYPES)[number]

export type AccountTypeConfig = {
  value: AccountType
  title: string
  shortTitle: string
  description: string
  primaryNavLabel: string
  focus: string[]
  recommendedPlanCode: string
}

export const ACCOUNT_TYPE_CONFIGS: AccountTypeConfig[] = [
  {
    value: 'solo_investor',
    title: 'Solo Investor',
    shortTitle: 'Solo Investor',
    description: 'Analyze your own rental, flip, BRRRR and wholesale deals.',
    primaryNavLabel: 'Deals',
    recommendedPlanCode: 'solo_investor',
    focus: ['Deal Analyzer', 'BRRRR', 'Buy & Hold', 'Cashflow', '5-Year Projection'],
  },
  {
    value: 'wholesaler',
    title: 'Wholesaler',
    shortTitle: 'Wholesaler',
    description: 'Underwrite deals and prepare them for buyer distribution.',
    primaryNavLabel: 'Deals',
    recommendedPlanCode: 'wholesaler',
    focus: ['ARV', 'Rehab', 'Wholesale Spread', 'Buyer List', 'Buyer Matching'],
  },
  {
    value: 'landlord',
    title: 'Landlord',
    shortTitle: 'Landlord',
    description: 'Compare current rent against market rent, NOI, cap rate and DSCR.',
    primaryNavLabel: 'Properties',
    recommendedPlanCode: 'landlord',
    focus: ['Properties', 'Market Rent', 'NOI', 'Cap Rate', 'DSCR'],
  },
  {
    value: 'section_8_landlord',
    title: 'Section 8 Landlord',
    shortTitle: 'Section 8',
    description: 'Focus on HUD rent, Section 8 upside and inspection readiness.',
    primaryNavLabel: 'Properties',
    recommendedPlanCode: 'section_8_landlord',
    focus: ['HUD Rent', 'Section 8 Upside', 'PHA Notes', 'Cashflow', 'DSCR'],
  },
  {
    value: 'brrrr_investor',
    title: 'BRRRR Investor',
    shortTitle: 'BRRRR',
    description: 'Model rehab, refinance, cash left in deal and cashflow after refi.',
    primaryNavLabel: 'BRRRR Deals',
    recommendedPlanCode: 'pro_investor',
    focus: ['ARV', 'Rehab', 'Refi LTV', 'Cash Left In Deal', 'Cashflow After Refi'],
  },
  {
    value: 'fix_and_flip_investor',
    title: 'Fix & Flip Investor',
    shortTitle: 'Fix & Flip',
    description: 'Analyze ARV, rehab, holding costs, selling costs and profit margins.',
    primaryNavLabel: 'Flip Deals',
    recommendedPlanCode: 'pro_investor',
    focus: ['ARV', 'Rehab', 'Projected Profit', 'Profit Margin', 'Timeline Risk'],
  },
  {
    value: 'community_guru_owner',
    title: 'Community / Guru Owner',
    shortTitle: 'Community',
    description: 'Create a workspace where members can submit deals for review.',
    primaryNavLabel: 'Member Deals',
    recommendedPlanCode: 'community_guru',
    focus: ['Members', 'Submitted Deals', 'Deal Review', 'Buyer List', 'White Label'],
  },
  {
    value: 'team_company',
    title: 'Team / Company',
    shortTitle: 'Team',
    description: 'Run acquisitions, disposition, buyers and deal analysis as a team.',
    primaryNavLabel: 'Team Deals',
    recommendedPlanCode: 'team_company',
    focus: ['Team Members', 'Assigned Deals', 'Buyer CRM', 'Reports', 'Usage Limits'],
  },
]

export const accountTypeLabels = Object.fromEntries(
  ACCOUNT_TYPE_CONFIGS.map((item) => [item.value, item.title]),
) as Record<AccountType, string>

export function isAccountType(value: string | null | undefined): value is AccountType {
  return Boolean(value && ACCOUNT_TYPES.includes(value as AccountType))
}

export function normalizeAccountType(value: string | null | undefined): AccountType {
  return isAccountType(value) ? value : 'solo_investor'
}

export function getAccountTypeConfig(value: string | null | undefined): AccountTypeConfig {
  const accountType = normalizeAccountType(value)
  return ACCOUNT_TYPE_CONFIGS.find((item) => item.value === accountType) || ACCOUNT_TYPE_CONFIGS[0]
}
