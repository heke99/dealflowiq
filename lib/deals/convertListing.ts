/**
 * Pure mapping from a market_listings row to a deals insert payload.
 *
 * Extracted from convertListingToDealAction (app/market/actions.ts) so the
 * field mapping can be unit-tested without Supabase. The output must stay
 * identical to the original inline mapping.
 */
import type { Row } from '@/lib/types/rows'

export function listingToDealPayload(listing: Row, params: { organizationId: string; userId: string }): Record<string, unknown> {
  return {
    organization_id: params.organizationId,
    created_by: params.userId,
    assigned_user_id: params.userId,
    title: listing.title || listing.address || 'Market opportunity',
    status: 'imported',
    source_url: listing.source_url,
    source_platform: listing.source_type,
    primary_image_url: listing.primary_image_url,
    image_urls: listing.image_urls || [],
    visibility: 'private',
    property_type: listing.property_type,
    asking_price: listing.asking_price || listing.list_price,
    purchase_price: listing.list_price || listing.asking_price,
    arv: listing.arv,
    rehab_estimate: listing.rehab_estimate,
    current_rent: listing.current_rent || listing.estimated_rent,
    market_rent: listing.market_rent,
    section8_rent: listing.hud_rent,
    taxes_annual: listing.taxes_annual,
    insurance_annual: listing.insurance_annual,
    hoa_monthly: listing.hoa_monthly,
    utilities_monthly: listing.utilities_monthly,
    notes: listing.description,
  }
}
