export type ProviderSourceType = 'zillow' | 'investorlift' | 'redfin' | 'realtor' | 'crexi' | 'loopnet' | 'apartments' | 'generic' | 'manual_url' | 'other'

export type ProviderImportPolicy = {
  sourceType: ProviderSourceType | string
  providerName: string
  active: boolean
  maxListingsPerHour: number
  maxListingsPerDay: number | null
  storageDays: number
  canStoreImages: boolean
  canStoreDescription: boolean
  canStoreListingData: boolean
  requiresSourceLink: boolean
  requiresAttribution: boolean
  attributionLabel: string
  notes: string[]
}

export const DEFAULT_PROVIDER_POLICIES: Record<string, ProviderImportPolicy> = {
  investorlift: {
    sourceType: 'investorlift',
    providerName: 'InvestorLift',
    active: true,
    maxListingsPerHour: 40,
    maxListingsPerDay: null,
    storageDays: 15,
    canStoreImages: true,
    canStoreDescription: true,
    canStoreListingData: true,
    requiresSourceLink: true,
    requiresAttribution: true,
    attributionLabel: 'Source: InvestorLift',
    notes: [
      'Authorized live import only. Do not use proxy rotation, CAPTCHA bypass, or anti-bot circumvention.',
      'Maximum 40 listing detail imports per organization per rolling hour under the configured InvestorLift access.',
      'Imported listing data/images expire after 15 days unless refreshed through an authorized import.',
      'Keep the original InvestorLift source link visible so users can open the provider listing.',
    ],
  },
  zillow: {
    sourceType: 'zillow',
    providerName: 'Zillow',
    active: true,
    maxListingsPerHour: 10,
    maxListingsPerDay: null,
    storageDays: 15,
    canStoreImages: true,
    canStoreDescription: true,
    canStoreListingData: true,
    requiresSourceLink: true,
    requiresAttribution: true,
    attributionLabel: 'Source: Zillow',
    notes: [
      'Authorized URL import only. Do not use proxy rotation, CAPTCHA bypass, or anti-bot circumvention.',
      'Maximum 10 listing detail imports per organization per rolling hour unless provider policy is changed.',
      'Imported listing data/images expire after 15 days unless refreshed through an authorized import.',
      'Keep the original source link visible so users can open the provider listing.',
    ],
  },
  redfin: {
    sourceType: 'redfin',
    providerName: 'Redfin',
    active: false,
    maxListingsPerHour: 10,
    maxListingsPerDay: null,
    storageDays: 15,
    canStoreImages: true,
    canStoreDescription: true,
    canStoreListingData: true,
    requiresSourceLink: true,
    requiresAttribution: true,
    attributionLabel: 'Source: Redfin',
    notes: ['Adapter structure is ready. Enable only after provider permission/rate limits are configured.'],
  },
  realtor: {
    sourceType: 'realtor',
    providerName: 'Realtor.com',
    active: false,
    maxListingsPerHour: 10,
    maxListingsPerDay: null,
    storageDays: 15,
    canStoreImages: true,
    canStoreDescription: true,
    canStoreListingData: true,
    requiresSourceLink: true,
    requiresAttribution: true,
    attributionLabel: 'Source: Realtor.com',
    notes: ['Adapter structure is ready. Enable only after provider permission/rate limits are configured.'],
  },
  crexi: {
    sourceType: 'crexi',
    providerName: 'Crexi',
    active: false,
    maxListingsPerHour: 10,
    maxListingsPerDay: null,
    storageDays: 15,
    canStoreImages: true,
    canStoreDescription: true,
    canStoreListingData: true,
    requiresSourceLink: true,
    requiresAttribution: true,
    attributionLabel: 'Source: Crexi',
    notes: ['Commercial/multifamily adapter structure is ready. Enable only after provider permission/rate limits are configured.'],
  },
  loopnet: {
    sourceType: 'loopnet',
    providerName: 'LoopNet',
    active: false,
    maxListingsPerHour: 10,
    maxListingsPerDay: null,
    storageDays: 15,
    canStoreImages: true,
    canStoreDescription: true,
    canStoreListingData: true,
    requiresSourceLink: true,
    requiresAttribution: true,
    attributionLabel: 'Source: LoopNet',
    notes: ['Commercial/multifamily adapter structure is ready. Enable only after provider permission/rate limits are configured.'],
  },
  generic: {
    sourceType: 'generic',
    providerName: 'Generic URL',
    active: true,
    maxListingsPerHour: 10,
    maxListingsPerDay: null,
    storageDays: 15,
    canStoreImages: false,
    canStoreDescription: true,
    canStoreListingData: true,
    requiresSourceLink: true,
    requiresAttribution: false,
    attributionLabel: 'Source listing',
    notes: ['Generic import can normalize direct listing pages but search parsing is provider-specific.'],
  },
}

export const ZILLOW_AUTHORIZED_IMPORT_POLICY = DEFAULT_PROVIDER_POLICIES.zillow

export function normalizeProviderSourceType(sourceType: string | null | undefined): string {
  const value = String(sourceType || '').toLowerCase().trim()
  if (['zillow', 'investorlift', 'redfin', 'realtor', 'crexi', 'loopnet', 'apartments'].includes(value)) return value
  if (value === 'manual_url' || value === 'manual') return 'manual_url'
  if (value === 'generic') return 'generic'
  return 'other'
}

export function getProviderImportPolicy(sourceType: string | null | undefined, override?: Partial<ProviderImportPolicy> | null): ProviderImportPolicy | null {
  const normalized = normalizeProviderSourceType(sourceType)
  const base = DEFAULT_PROVIDER_POLICIES[normalized] || DEFAULT_PROVIDER_POLICIES.generic
  if (!base) return null
  return {
    ...base,
    ...(override || {}),
    sourceType: override?.sourceType || base.sourceType,
    providerName: override?.providerName || base.providerName,
    notes: override?.notes || base.notes,
  }
}

export function sourceDataExpiryDate(policy: ProviderImportPolicy, now = new Date()) {
  const expiresAt = new Date(now)
  expiresAt.setDate(expiresAt.getDate() + Math.max(1, Number(policy.storageDays || 15)))
  return expiresAt.toISOString()
}

export function providerPolicyMetadata(policy: ProviderImportPolicy) {
  return {
    providerName: policy.providerName,
    sourceType: policy.sourceType,
    active: policy.active,
    maxListingsPerHour: policy.maxListingsPerHour,
    maxListingsPerDay: policy.maxListingsPerDay,
    storageDays: policy.storageDays,
    canStoreImages: policy.canStoreImages,
    canStoreDescription: policy.canStoreDescription,
    canStoreListingData: policy.canStoreListingData,
    requiresSourceLink: policy.requiresSourceLink,
    requiresAttribution: policy.requiresAttribution,
    attributionLabel: policy.attributionLabel,
    notes: policy.notes,
  }
}
