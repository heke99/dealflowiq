/**
 * Pure mapping from a deal row (with its properties embed) to the normalized
 * market_listings payload created when a deal is published to Market.
 *
 * Extracted from publishDealToMarketAction (app/market/actions.ts) so the
 * mapping can be unit-tested without Supabase. The output must stay identical
 * to the original inline mapping.
 */
import { firstRow, type Row } from '@/lib/types/rows'

export type PublishDealListingParams = {
  visibility: string
  dealId: string
  publishedAt: string
  /** Form override; falls back to the deal's stored title (unknown-typed Row field). */
  title?: unknown
  summary?: string | null
  /** Form override; when set it becomes the listing's asking/list price. */
  askingPrice?: number | null
  /**
   * Contact email only applies to the public_deal_posts row — the Market
   * listing intentionally exposes no broker contact. It stays in the
   * signature so tests can assert it never leaks into the listing payload.
   */
  contactEmail?: string | null
}

export function dealToMarketListingPayload(deal: Row, params: PublishDealListingParams): Record<string, unknown> {
  const property = firstRow(deal.properties)
  return {
    source_type: params.visibility === 'community' ? 'community_deal' : 'public_deal',
    external_listing_id: params.dealId,
    source_url: deal.source_url,
    title: params.title || deal.title,
    address: property?.address,
    city: property?.city,
    state: property?.state,
    zip_code: property?.zip_code,
    county: property?.county,
    property_type: deal.property_type,
    units: property?.number_of_units || 1,
    bedrooms: property?.bedrooms,
    bathrooms: property?.bathrooms,
    sqft: property?.square_feet,
    lot_size: property?.lot_size,
    year_built: property?.year_built,
    list_price: params.askingPrice || deal.asking_price || deal.purchase_price,
    asking_price: params.askingPrice || deal.asking_price || deal.purchase_price,
    arv: deal.arv,
    rehab_estimate: deal.rehab_estimate,
    current_rent: deal.current_rent,
    market_rent: deal.market_rent,
    hud_rent: deal.section8_rent,
    taxes_annual: deal.taxes_annual,
    insurance_annual: deal.insurance_annual,
    hoa_monthly: deal.hoa_monthly,
    utilities_monthly: deal.utilities_monthly,
    description: params.summary || deal.notes,
    primary_image_url: deal.primary_image_url,
    image_urls: deal.image_urls || [],
    visibility: params.visibility,
    status: 'active',
    raw_payload: { source: 'published_deal', dealId: params.dealId, createdAt: params.publishedAt },
  }
}
