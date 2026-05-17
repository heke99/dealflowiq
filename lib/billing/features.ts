import type { AccountType } from '@/lib/product/accountTypes'

export const FEATURE_KEYS = [
  'deals',
  'deal_analyzer',
  'market_search',
  'rent_analysis',
  'market_rent',
  'calculators',
  'section8_hud',
  'brrrr',
  'flip',
  'wholesale',
  'seller_finance',
  'five_year_projection',
  'csv_export',
  'pdf_export',
  'buyers',
  'buyer_matching',
  'deal_distribution',
  'community_members',
  'white_label',
  'ai_review',
  'lender_view',
  'admin_plan_management',
  'market_source_imports',
  'market_opportunities',
  'scheduled_market_imports',
  'public_community_deals',
] as const

export type FeatureKey = (typeof FEATURE_KEYS)[number]
export type FeatureMap = Partial<Record<FeatureKey, boolean>>
export type LimitMap = Record<string, number | null>

export const FREE_FEATURES: FeatureMap = {
  market_search: true,
  market_rent: true,
  market_opportunities: true,
  public_community_deals: true,
}

export const CORE_FEATURES: FeatureMap = {
  deals: true,
  deal_analyzer: true,
  market_search: true,
  rent_analysis: true,
  market_rent: true,
  calculators: true,
  market_opportunities: true,
}

export const FREE_LIMITS: LimitMap = {
  max_visible_opportunities: 2,
  opportunity_detail_cooldown_hours: 48,
  max_saved_deals: 3,
  max_imports_per_7_days: 1,
}

export const TRIAL_LIMITS: LimitMap = {
  max_visible_opportunities: null,
  opportunity_detail_cooldown_hours: 0,
  max_saved_deals: null,
  max_imports_per_7_days: null,
}

export const ALL_FEATURES: FeatureMap = FEATURE_KEYS.reduce<FeatureMap>((acc, feature) => {
  acc[feature] = true
  return acc
}, {})

export const PREMIUM_FEATURES: FeatureKey[] = [
  'deals',
  'deal_analyzer',
  'rent_analysis',
  'section8_hud',
  'brrrr',
  'flip',
  'wholesale',
  'seller_finance',
  'five_year_projection',
  'csv_export',
  'pdf_export',
  'buyers',
  'buyer_matching',
  'deal_distribution',
  'community_members',
  'white_label',
  'ai_review',
  'lender_view',
  'market_source_imports',
  'scheduled_market_imports',
]

export const featureLabels: Record<FeatureKey, string> = {
  deals: 'Deals / Properties',
  deal_analyzer: 'Deal Analyzer',
  market_search: 'Market Search',
  rent_analysis: 'Rent Analysis',
  market_rent: 'Market Rent',
  calculators: 'Basic Calculators',
  section8_hud: 'Section 8 / HUD',
  brrrr: 'BRRRR Calculator',
  flip: 'Fix & Flip Calculator',
  wholesale: 'Wholesale Calculator',
  seller_finance: 'Seller Finance',
  five_year_projection: '5-Year Projection',
  csv_export: 'CSV Export',
  pdf_export: 'PDF Export',
  buyers: 'Buyer CRM',
  buyer_matching: 'Buyer Matching',
  deal_distribution: 'Deal Distribution',
  community_members: 'Community Members',
  white_label: 'White Label',
  ai_review: 'AI Deal Review',
  lender_view: 'Bank / Lender View',
  admin_plan_management: 'Admin Plan Management',
  market_source_imports: 'Premium Market Source Imports',
  market_opportunities: 'Market Opportunities',
  scheduled_market_imports: 'Scheduled Market Imports',
  public_community_deals: 'Public / Community Deals',
}

export const accountTypeDefaultFeatures: Record<AccountType, FeatureMap> = {
  solo_investor: { ...CORE_FEATURES, section8_hud: true, brrrr: true, flip: true, wholesale: true, five_year_projection: true, csv_export: true, lender_view: true },
  wholesaler: { ...CORE_FEATURES, wholesale: true, flip: true, buyers: true, buyer_matching: true, deal_distribution: true, csv_export: true },
  landlord: { ...CORE_FEATURES, section8_hud: true, five_year_projection: true, csv_export: true, lender_view: true },
  section_8_landlord: { ...CORE_FEATURES, section8_hud: true, five_year_projection: true, csv_export: true, lender_view: true },
  brrrr_investor: { ...CORE_FEATURES, section8_hud: true, brrrr: true, five_year_projection: true, csv_export: true, lender_view: true },
  fix_and_flip_investor: { ...CORE_FEATURES, flip: true, wholesale: true, csv_export: true },
  community_guru_owner: { ...ALL_FEATURES, admin_plan_management: false },
  team_company: { ...ALL_FEATURES, admin_plan_management: false },
}

export function mergeFeatures(...featureMaps: Array<FeatureMap | null | undefined>): FeatureMap {
  return featureMaps.reduce<FeatureMap>((acc, map) => ({ ...acc, ...(map || {}) }), {})
}

export function canUseFeature(features: FeatureMap | null | undefined, feature: FeatureKey) {
  return Boolean(features?.[feature])
}

export function isCoreFeature(feature: FeatureKey) {
  return Boolean(CORE_FEATURES[feature])
}
