import type { MarketSourceType } from '@/lib/market/sourceConnectors'

export type MarketSourceAdapter = {
  type: MarketSourceType
  label: string
  category: 'residential' | 'commercial' | 'rental' | 'csv' | 'manual' | 'api'
  userAgent: string
  referrer?: string
  searchUrlHint: string
  urlExamples: string[]
  importNotes: string[]
  listingIdPatterns: RegExp[]
  priceKeys: string[]
  rentKeys: string[]
  brokerKeys: string[]
}

const defaultUserAgent = 'DealFlowIQBot/2.0 (+authorized-market-import; contact=admin@dealflowiq.com)'

const adapters: Record<string, MarketSourceAdapter> = {
  zillow: {
    type: 'zillow',
    label: 'Zillow',
    category: 'residential',
    userAgent: defaultUserAgent,
    referrer: 'https://www.zillow.com/',
    searchUrlHint: 'Paste authorized Zillow property URLs or saved-search URLs that your account is allowed to import.',
    urlExamples: ['https://www.zillow.com/homedetails/...'],
    importNotes: ['Best for single family, duplex, small residential and rent comps.', 'The adapter ignores sale IDs and non-rent price values as monthly rent.'],
    listingIdPatterns: [/zpid["'\s:]+([A-Za-z0-9_-]{5,})/i, /\/homedetails\/[^/]+\/([0-9]+)_zpid/i, /\/(\d{5,})_zpid/i],
    priceKeys: ['price', 'listPrice', 'unformattedPrice', 'askingPrice'],
    rentKeys: ['rentZestimate', 'monthlyRent', 'rent', 'priceForRent'],
    brokerKeys: ['brokerName', 'agentName', 'listingAgent', 'attributionInfo'],
  },
  crexi: {
    type: 'crexi',
    label: 'Crexi',
    category: 'commercial',
    userAgent: defaultUserAgent,
    referrer: 'https://www.crexi.com/',
    searchUrlHint: 'Paste authorized Crexi property or search URLs for commercial listings.',
    urlExamples: ['https://www.crexi.com/properties/...'],
    importNotes: ['Best for commercial, multifamily, retail, office and land.', 'Commercial listings may need manual NOI/rent verification.'],
    listingIdPatterns: [/propertyId["'\s:]+([A-Za-z0-9_-]{5,})/i, /listingId["'\s:]+([A-Za-z0-9_-]{5,})/i, /properties\/([0-9]+)/i],
    priceKeys: ['askingPrice', 'price', 'listPrice', 'investmentHighlights'],
    rentKeys: ['noi', 'proFormaNOI', 'rent', 'leaseRate'],
    brokerKeys: ['broker', 'brokerName', 'listingBroker', 'contactName'],
  },
  loopnet: {
    type: 'loopnet',
    label: 'LoopNet',
    category: 'commercial',
    userAgent: defaultUserAgent,
    referrer: 'https://www.loopnet.com/',
    searchUrlHint: 'Paste authorized LoopNet listing URLs. Use source logs to monitor blocked requests.',
    urlExamples: ['https://www.loopnet.com/Listing/...'],
    importNotes: ['Best for commercial listings. Avoid republishing copyrighted listing copy/photos without rights.', 'Use source link + DealFlowIQ analysis as the product layer.'],
    listingIdPatterns: [/listingId["'\s:]+([A-Za-z0-9_-]{5,})/i, /Listing\/[^/]+\/([0-9]+)/i],
    priceKeys: ['price', 'askingPrice', 'salePrice'],
    rentKeys: ['leaseRate', 'rent', 'noi'],
    brokerKeys: ['broker', 'contactName', 'agentName'],
  },
  redfin: {
    type: 'redfin',
    label: 'Redfin',
    category: 'residential',
    userAgent: defaultUserAgent,
    referrer: 'https://www.redfin.com/',
    searchUrlHint: 'Paste authorized Redfin listing URLs.',
    urlExamples: ['https://www.redfin.com/.../home/...'],
    importNotes: ['Good backup source for residential listings and sale-price data.'],
    listingIdPatterns: [/listingId["'\s:]+([A-Za-z0-9_-]{5,})/i, /propertyId["'\s:]+([A-Za-z0-9_-]{5,})/i],
    priceKeys: ['price', 'listPrice'],
    rentKeys: ['rent', 'monthlyRent'],
    brokerKeys: ['agentName', 'brokerName'],
  },
  realtor: {
    type: 'realtor',
    label: 'Realtor.com',
    category: 'residential',
    userAgent: defaultUserAgent,
    referrer: 'https://www.realtor.com/',
    searchUrlHint: 'Paste authorized Realtor.com listing URLs.',
    urlExamples: ['https://www.realtor.com/realestateandhomes-detail/...'],
    importNotes: ['Useful for residential sale/listing details.'],
    listingIdPatterns: [/listingId["'\s:]+([A-Za-z0-9_-]{5,})/i, /property_id["'\s:]+([A-Za-z0-9_-]{5,})/i],
    priceKeys: ['price', 'listPrice'],
    rentKeys: ['rent', 'monthlyRent'],
    brokerKeys: ['advertisers', 'brokerName', 'agentName'],
  },
  apartments: {
    type: 'apartments',
    label: 'Apartments.com',
    category: 'rental',
    userAgent: defaultUserAgent,
    referrer: 'https://www.apartments.com/',
    searchUrlHint: 'Paste authorized Apartments.com rental comp URLs.',
    urlExamples: ['https://www.apartments.com/...'],
    importNotes: ['Best for rent comps; usually not full purchase opportunities.'],
    listingIdPatterns: [/propertyId["'\s:]+([A-Za-z0-9_-]{5,})/i, /listingId["'\s:]+([A-Za-z0-9_-]{5,})/i],
    priceKeys: ['price', 'minRent', 'maxRent'],
    rentKeys: ['rent', 'minRent', 'maxRent', 'monthlyRent'],
    brokerKeys: ['propertyManager', 'contactName'],
  },
  csv: {
    type: 'csv',
    label: 'CSV Feed',
    category: 'csv',
    userAgent: defaultUserAgent,
    searchUrlHint: 'Paste CSV rows or connect a CSV feed URL.',
    urlExamples: [],
    importNotes: ['Best for bulk backfills from brokers, partners and paid data providers.'],
    listingIdPatterns: [],
    priceKeys: ['price', 'list_price', 'asking_price'],
    rentKeys: ['rent', 'market_rent', 'hud_rent'],
    brokerKeys: ['broker_name', 'contact_name'],
  },
  partner_api: {
    type: 'partner_api',
    label: 'Partner API',
    category: 'api',
    userAgent: defaultUserAgent,
    searchUrlHint: 'Use for approved API feeds and paid data providers.',
    urlExamples: [],
    importNotes: ['Best long-term connector model for production scale.'],
    listingIdPatterns: [],
    priceKeys: ['price', 'list_price', 'asking_price'],
    rentKeys: ['rent', 'market_rent', 'estimated_rent'],
    brokerKeys: ['broker_name', 'contact_name'],
  },
  generic: {
    type: 'generic' as any,
    label: 'Generic authorized URL',
    category: 'manual',
    userAgent: defaultUserAgent,
    searchUrlHint: 'Paste an authorized provider URL after policy is configured.',
    urlExamples: [],
    importNotes: ['Fallback adapter for approved providers. Keep inactive unless permission and rate limits are configured.'],
    listingIdPatterns: [/\/(\d{5,})(?:[/?#_-]|$)/],
    priceKeys: ['price', 'listPrice', 'askingPrice'],
    rentKeys: ['rent', 'monthlyRent'],
    brokerKeys: ['broker', 'agent'],
  },
  manual_url: {
    type: 'manual_url',
    label: 'Manual URL',
    category: 'manual',
    userAgent: defaultUserAgent,
    searchUrlHint: 'Paste any authorized property/listing URL.',
    urlExamples: [],
    importNotes: ['Fallback connector when the system cannot identify the source.'],
    listingIdPatterns: [/\/(\d{5,})(?:[/?#_-]|$)/],
    priceKeys: ['price', 'listPrice', 'askingPrice'],
    rentKeys: ['rent', 'monthlyRent', 'rentZestimate'],
    brokerKeys: ['broker', 'agent', 'contactName'],
  },
  manual: {
    type: 'manual',
    label: 'Manual',
    category: 'manual',
    userAgent: defaultUserAgent,
    searchUrlHint: 'Add one listing by hand.',
    urlExamples: [],
    importNotes: ['Use when the source is private or not fetchable.'],
    listingIdPatterns: [],
    priceKeys: ['price', 'list_price', 'asking_price'],
    rentKeys: ['rent', 'market_rent', 'hud_rent'],
    brokerKeys: ['broker_name', 'contact_name'],
  },
  other: {
    type: 'other',
    label: 'Other',
    category: 'manual',
    userAgent: defaultUserAgent,
    searchUrlHint: 'Use for authorized sources not listed yet.',
    urlExamples: [],
    importNotes: ['The generic adapter will try JSON-LD, OpenGraph and common listing fields.'],
    listingIdPatterns: [/\/(\d{5,})(?:[/?#_-]|$)/],
    priceKeys: ['price', 'listPrice', 'askingPrice'],
    rentKeys: ['rent', 'monthlyRent'],
    brokerKeys: ['broker', 'agent'],
  },
}

export function getMarketSourceAdapter(sourceType?: string | null): MarketSourceAdapter {
  const key = String(sourceType || '').toLowerCase()
  return adapters[key] || adapters.manual_url
}

export function getMarketSourceAdapters() {
  return Object.values(adapters)
}
