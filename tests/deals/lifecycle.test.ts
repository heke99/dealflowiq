import { describe, expect, it } from 'vitest'
import { listingToDealPayload } from '@/lib/deals/convertListing'
import { dealToMarketListingPayload } from '@/lib/deals/publishDeal'
import {
  ARCHIVED_DEAL_STATUS,
  DEAL_STATUSES,
  duplicateDealPayload,
  duplicatePropertyPayload,
  isDealStatus,
  normalizeDealStatus,
} from '@/lib/deals/lifecycle'
import { formatFileSize } from '@/lib/deals/files'
import type { Row } from '@/lib/types/rows'

const orgAndUser = { organizationId: 'org-1', userId: 'user-1' }

const marketListing: Row = {
  id: 'listing-1',
  organization_id: 'other-org',
  title: '12 Main St duplex',
  address: '12 Main St',
  city: 'Cleveland',
  state: 'OH',
  zip_code: '44101',
  county: 'Cuyahoga',
  source_url: 'https://example.com/listing/1',
  source_type: 'zillow',
  primary_image_url: 'https://img.example/1.jpg',
  image_urls: ['https://img.example/1.jpg', 'https://img.example/2.jpg'],
  property_type: 'Duplex',
  list_price: 120000,
  asking_price: 125000,
  arv: 180000,
  rehab_estimate: 25000,
  current_rent: null,
  estimated_rent: 1350,
  market_rent: 1500,
  hud_rent: 1450,
  taxes_annual: 2400,
  insurance_annual: 1200,
  hoa_monthly: 0,
  utilities_monthly: 150,
  description: 'Solid duplex near downtown.',
  bedrooms: 3,
  bathrooms: 2,
  sqft: 1600,
  units: 2,
}

describe('listingToDealPayload', () => {
  it('creates a private imported deal owned by the converting user', () => {
    const payload = listingToDealPayload(marketListing, orgAndUser)
    expect(payload.organization_id).toBe('org-1')
    expect(payload.created_by).toBe('user-1')
    expect(payload.assigned_user_id).toBe('user-1')
    expect(payload.status).toBe('imported')
    expect(payload.visibility).toBe('private')
  })

  it('maps prices with asking/list fallbacks in both directions', () => {
    const payload = listingToDealPayload(marketListing, orgAndUser)
    expect(payload.asking_price).toBe(125000)
    expect(payload.purchase_price).toBe(120000)

    const onlyListPrice = listingToDealPayload({ ...marketListing, asking_price: null }, orgAndUser)
    expect(onlyListPrice.asking_price).toBe(120000)
    expect(onlyListPrice.purchase_price).toBe(120000)

    const onlyAskingPrice = listingToDealPayload({ ...marketListing, list_price: null }, orgAndUser)
    expect(onlyAskingPrice.asking_price).toBe(125000)
    expect(onlyAskingPrice.purchase_price).toBe(125000)
  })

  it('maps rents including estimated-rent fallback and hud_rent -> section8_rent', () => {
    const payload = listingToDealPayload(marketListing, orgAndUser)
    expect(payload.current_rent).toBe(1350)
    expect(payload.market_rent).toBe(1500)
    expect(payload.section8_rent).toBe(1450)

    const withCurrentRent = listingToDealPayload({ ...marketListing, current_rent: 1100 }, orgAndUser)
    expect(withCurrentRent.current_rent).toBe(1100)
  })

  it('carries source metadata, images and description into the deal', () => {
    const payload = listingToDealPayload(marketListing, orgAndUser)
    expect(payload.source_url).toBe('https://example.com/listing/1')
    expect(payload.source_platform).toBe('zillow')
    expect(payload.primary_image_url).toBe('https://img.example/1.jpg')
    expect(payload.image_urls).toEqual(['https://img.example/1.jpg', 'https://img.example/2.jpg'])
    expect(payload.notes).toBe('Solid duplex near downtown.')
  })

  it('falls back to address then generic title when the listing has no title', () => {
    expect(listingToDealPayload({ ...marketListing, title: null }, orgAndUser).title).toBe('12 Main St')
    expect(listingToDealPayload({ ...marketListing, title: null, address: null }, orgAndUser).title).toBe('Market opportunity')
  })
})

const publishableDeal: Row = {
  id: 'deal-1',
  title: 'Wholesale duplex',
  notes: 'Internal notes about the deal.',
  source_url: 'https://example.com/source',
  property_type: 'Duplex',
  asking_price: 140000,
  purchase_price: 120000,
  arv: 190000,
  rehab_estimate: 30000,
  current_rent: 1200,
  market_rent: 1550,
  section8_rent: 1500,
  taxes_annual: 2600,
  insurance_annual: 1300,
  hoa_monthly: 0,
  utilities_monthly: 100,
  primary_image_url: 'https://img.example/deal.jpg',
  image_urls: ['https://img.example/deal.jpg'],
  properties: [{
    address: '99 Oak Ave',
    city: 'Columbus',
    state: 'OH',
    zip_code: '43004',
    county: 'Franklin',
    number_of_units: 2,
    bedrooms: 3,
    bathrooms: 1.5,
    square_feet: 1500,
    lot_size: '0.2 acres',
    year_built: 1950,
  }],
}

const publishParams = { dealId: 'deal-1', publishedAt: '2026-07-05T00:00:00.000Z' }

describe('dealToMarketListingPayload', () => {
  it('maps community visibility to the community_deal source type', () => {
    const payload = dealToMarketListingPayload(publishableDeal, { ...publishParams, visibility: 'community' })
    expect(payload.source_type).toBe('community_deal')
    expect(payload.visibility).toBe('community')
  })

  it('maps public (and team) visibility to the public_deal source type', () => {
    expect(dealToMarketListingPayload(publishableDeal, { ...publishParams, visibility: 'public' }).source_type).toBe('public_deal')
    expect(dealToMarketListingPayload(publishableDeal, { ...publishParams, visibility: 'team' }).source_type).toBe('public_deal')
  })

  it('retains the deal id in raw_payload and external_listing_id for unpublish matching', () => {
    const payload = dealToMarketListingPayload(publishableDeal, { ...publishParams, visibility: 'public' })
    expect(payload.external_listing_id).toBe('deal-1')
    expect(payload.raw_payload).toEqual({ source: 'published_deal', dealId: 'deal-1', createdAt: '2026-07-05T00:00:00.000Z' })
    expect(payload.status).toBe('active')
  })

  it('maps property embed fields and deal financials including hud rent', () => {
    const payload = dealToMarketListingPayload(publishableDeal, { ...publishParams, visibility: 'community' })
    expect(payload.address).toBe('99 Oak Ave')
    expect(payload.city).toBe('Columbus')
    expect(payload.units).toBe(2)
    expect(payload.sqft).toBe(1500)
    expect(payload.list_price).toBe(140000)
    expect(payload.asking_price).toBe(140000)
    expect(payload.hud_rent).toBe(1500)
    expect(payload.market_rent).toBe(1550)
  })

  it('prefers form title/summary overrides and falls back to deal title/notes', () => {
    const overridden = dealToMarketListingPayload(publishableDeal, { ...publishParams, visibility: 'public', title: 'Public title', summary: 'Public summary' })
    expect(overridden.title).toBe('Public title')
    expect(overridden.description).toBe('Public summary')

    const fallback = dealToMarketListingPayload(publishableDeal, { ...publishParams, visibility: 'public' })
    expect(fallback.title).toBe('Wholesale duplex')
    expect(fallback.description).toBe('Internal notes about the deal.')
  })

  it('falls back to purchase price and defaults units to 1 without a property embed', () => {
    const bare = dealToMarketListingPayload({ ...publishableDeal, asking_price: null, properties: [] }, { ...publishParams, visibility: 'public' })
    expect(bare.list_price).toBe(120000)
    expect(bare.asking_price).toBe(120000)
    expect(bare.units).toBe(1)
    expect(bare.address).toBeUndefined()
  })
})

describe('deal status helpers', () => {
  it('accepts every status from the deals CHECK constraint and rejects unknown values', () => {
    for (const status of DEAL_STATUSES) expect(isDealStatus(status)).toBe(true)
    expect(isDealStatus('archived')).toBe(false)
    expect(isDealStatus('')).toBe(false)
    expect(isDealStatus(null)).toBe(false)
  })

  it('normalizes unknown statuses to the fallback', () => {
    expect(normalizeDealStatus('under_contract')).toBe('under_contract')
    expect(normalizeDealStatus('not-a-status')).toBe('draft')
    expect(normalizeDealStatus(undefined, 'imported')).toBe('imported')
  })

  it('uses a terminal status from the whitelist for archiving', () => {
    expect(ARCHIVED_DEAL_STATUS).toBe('dead')
    expect(isDealStatus(ARCHIVED_DEAL_STATUS)).toBe(true)
  })
})

describe('duplicateDealPayload', () => {
  const sourceDeal: Row = {
    id: 'deal-9',
    organization_id: 'org-9',
    created_by: 'someone-else',
    assigned_user_id: 'someone-else',
    title: 'Flip on Elm',
    status: 'under_contract',
    visibility: 'public',
    published_at: '2026-01-01T00:00:00.000Z',
    expires_at: '2026-02-01T00:00:00.000Z',
    created_at: '2025-12-01T00:00:00.000Z',
    updated_at: '2026-01-15T00:00:00.000Z',
    purchase_price: 90000,
    market_rent: 1400,
    notes: 'keep these notes',
    properties: [{ id: 'prop-9', address: '1 Elm St' }],
  }

  it('copies deal fields but resets identity, publish state and ownership', () => {
    const payload = duplicateDealPayload(sourceDeal, orgAndUser)
    expect(payload.id).toBeUndefined()
    expect(payload.created_at).toBeUndefined()
    expect(payload.updated_at).toBeUndefined()
    expect(payload.published_at).toBeUndefined()
    expect(payload.expires_at).toBeUndefined()
    expect(payload.properties).toBeUndefined()
    expect(payload.title).toBe('Flip on Elm (copy)')
    expect(payload.status).toBe('draft')
    expect(payload.visibility).toBe('private')
    expect(payload.organization_id).toBe('org-1')
    expect(payload.created_by).toBe('user-1')
    expect(payload.assigned_user_id).toBe('user-1')
    expect(payload.purchase_price).toBe(90000)
    expect(payload.market_rent).toBe(1400)
    expect(payload.notes).toBe('keep these notes')
  })

  it('copies the property row onto the new deal id', () => {
    const payload = duplicatePropertyPayload(
      { id: 'prop-9', deal_id: 'deal-9', organization_id: 'org-9', address: '1 Elm St', created_at: 'x', updated_at: 'y' },
      { organizationId: 'org-1', dealId: 'deal-new' }
    )
    expect(payload.id).toBeUndefined()
    expect(payload.created_at).toBeUndefined()
    expect(payload.updated_at).toBeUndefined()
    expect(payload.deal_id).toBe('deal-new')
    expect(payload.organization_id).toBe('org-1')
    expect(payload.address).toBe('1 Elm St')
  })
})

describe('formatFileSize', () => {
  it('formats bytes, kilobytes and megabytes and hides missing sizes', () => {
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(2048)).toBe('2 KB')
    expect(formatFileSize(3 * 1024 * 1024)).toBe('3.0 MB')
    expect(formatFileSize(0)).toBeNull()
    expect(formatFileSize(null)).toBeNull()
    expect(formatFileSize('not-a-number')).toBeNull()
  })
})
