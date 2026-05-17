import type { MarketSourceType } from '@/lib/market/sourceConnectors'

export type ProviderPolicy = {
  sourceType: MarketSourceType | 'generic'
  label: string
  active: boolean
  maxListingsPerHour: number
  maxListingsPerDay: number | null
  storageDays: number
  imagesAllowed: boolean
  descriptionAllowed: boolean
  sourceLinkRequired: boolean
  attributionRequired: boolean
  searchImportAllowed: boolean
  listingImportAllowed: boolean
  notes: string
}

export const DEFAULT_PROVIDER_POLICIES: Record<string, ProviderPolicy> = {
  zillow: {
    sourceType: 'zillow',
    label: 'Zillow',
    active: true,
    maxListingsPerHour: 10,
    maxListingsPerDay: null,
    storageDays: 15,
    imagesAllowed: true,
    descriptionAllowed: true,
    sourceLinkRequired: true,
    attributionRequired: true,
    searchImportAllowed: true,
    listingImportAllowed: true,
    notes: 'Authorized live import only. No proxy rotation, CAPTCHA bypass, or anti-bot circumvention.',
  },
  investorlift: {
    sourceType: 'investorlift',
    label: 'InvestorLift',
    active: true,
    maxListingsPerHour: 40,
    maxListingsPerDay: null,
    storageDays: 15,
    imagesAllowed: true,
    descriptionAllowed: true,
    sourceLinkRequired: true,
    attributionRequired: true,
    searchImportAllowed: true,
    listingImportAllowed: true,
    notes: 'Authorized live import under approved 40 listings/hour policy. No proxy rotation, CAPTCHA bypass, or anti-bot circumvention.',
  },
  redfin: {
    sourceType: 'redfin',
    label: 'Redfin',
    active: true,
    maxListingsPerHour: 10,
    maxListingsPerDay: null,
    storageDays: 15,
    imagesAllowed: true,
    descriptionAllowed: true,
    sourceLinkRequired: true,
    attributionRequired: true,
    searchImportAllowed: true,
    listingImportAllowed: true,
    notes: 'Authorized live import under same documented provider policy as Zillow. No proxy rotation, CAPTCHA bypass, or anti-bot circumvention.',
  },
  realtor: {
    sourceType: 'realtor',
    label: 'Realtor.com',
    active: true,
    maxListingsPerHour: 10,
    maxListingsPerDay: null,
    storageDays: 15,
    imagesAllowed: true,
    descriptionAllowed: true,
    sourceLinkRequired: true,
    attributionRequired: true,
    searchImportAllowed: true,
    listingImportAllowed: true,
    notes: 'Authorized live import under same documented provider policy as Zillow. No proxy rotation, CAPTCHA bypass, or anti-bot circumvention.',
  },
  crexi: {
    sourceType: 'crexi',
    label: 'Crexi',
    active: true,
    maxListingsPerHour: 10,
    maxListingsPerDay: null,
    storageDays: 15,
    imagesAllowed: true,
    descriptionAllowed: true,
    sourceLinkRequired: true,
    attributionRequired: true,
    searchImportAllowed: true,
    listingImportAllowed: true,
    notes: 'Authorized commercial live import under same documented provider policy as Zillow. No proxy rotation, CAPTCHA bypass, or anti-bot circumvention.',
  },
  loopnet: {
    sourceType: 'loopnet',
    label: 'LoopNet',
    active: true,
    maxListingsPerHour: 10,
    maxListingsPerDay: null,
    storageDays: 15,
    imagesAllowed: true,
    descriptionAllowed: true,
    sourceLinkRequired: true,
    attributionRequired: true,
    searchImportAllowed: true,
    listingImportAllowed: true,
    notes: 'Authorized commercial live import under same documented provider policy as Zillow. No proxy rotation, CAPTCHA bypass, or anti-bot circumvention.',
  },
  generic: {
    sourceType: 'generic',
    label: 'Generic authorized URL',
    active: false,
    maxListingsPerHour: 0,
    maxListingsPerDay: null,
    storageDays: 15,
    imagesAllowed: false,
    descriptionAllowed: false,
    sourceLinkRequired: true,
    attributionRequired: true,
    searchImportAllowed: false,
    listingImportAllowed: false,
    notes: 'Fallback adapter. Keep inactive unless the provider permission is documented.',
  },
}

export function providerPolicyFromRow(sourceType: string, row?: Record<string, any> | null): ProviderPolicy {
  const base = DEFAULT_PROVIDER_POLICIES[sourceType] || DEFAULT_PROVIDER_POLICIES.generic
  if (!row) return base
  return {
    ...base,
    active: Boolean(row.is_active ?? base.active),
    maxListingsPerHour: Number(row.max_listings_per_hour ?? base.maxListingsPerHour),
    maxListingsPerDay: row.max_listings_per_day === null || row.max_listings_per_day === undefined ? base.maxListingsPerDay : Number(row.max_listings_per_day),
    storageDays: Number(row.storage_days ?? base.storageDays),
    imagesAllowed: Boolean(row.images_allowed ?? base.imagesAllowed),
    descriptionAllowed: Boolean(row.description_allowed ?? base.descriptionAllowed),
    sourceLinkRequired: Boolean(row.source_link_required ?? base.sourceLinkRequired),
    attributionRequired: Boolean(row.attribution_required ?? base.attributionRequired),
    searchImportAllowed: Boolean(row.search_import_allowed ?? base.searchImportAllowed),
    listingImportAllowed: Boolean(row.listing_import_allowed ?? base.listingImportAllowed),
    notes: String(row.provider_notes || base.notes),
  }
}

export function providerPolicySnapshot(policy: ProviderPolicy) {
  return {
    sourceType: policy.sourceType,
    label: policy.label,
    maxListingsPerHour: policy.maxListingsPerHour,
    maxListingsPerDay: policy.maxListingsPerDay,
    storageDays: policy.storageDays,
    imagesAllowed: policy.imagesAllowed,
    descriptionAllowed: policy.descriptionAllowed,
    sourceLinkRequired: policy.sourceLinkRequired,
    attributionRequired: policy.attributionRequired,
    searchImportAllowed: policy.searchImportAllowed,
    listingImportAllowed: policy.listingImportAllowed,
    notes: policy.notes,
  }
}
