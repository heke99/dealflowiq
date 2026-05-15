import { lookupHudFmrByZip } from '@/lib/integrations/hud/fmrClient'
import { buildRentConfidenceBreakdown } from '@/lib/market/rentIntelligence'
import { recordMarketListingActivity } from '@/lib/market/activity'
import { createInAppNotification } from '@/lib/notifications'
import type { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { createSupabaseServerClient } from '@/lib/supabase/server'

type SupabaseLike = Awaited<ReturnType<typeof createSupabaseServerClient>> | ReturnType<typeof createSupabaseAdminClient>

type ApplyParams = {
  supabase: SupabaseLike
  listing: Record<string, any>
  organizationId: string
  userId?: string | null
  trigger?: 'auto_import' | 'manual_market_rent' | 'manual_hud' | 'manual_override'
}

export async function applyAutomatedRentIntelligence(params: ApplyParams) {
  const { supabase, listing, organizationId, userId } = params
  let hudSelectedRent: number | null = Number(listing.hud_rent || 0) || null
  let hudStatus: 'completed' | 'failed' | 'skipped' = 'skipped'
  let hudRaw: unknown = null
  const zip = String(listing.zip_code || '').trim()
  const bedrooms = Number(listing.bedrooms || 0) || null

  if (zip && ['residential', 'multifamily', '', null, undefined].includes(String(listing.asset_class || '').toLowerCase() || '')) {
    try {
      const hud = await lookupHudFmrByZip({ zipCode: zip, bedrooms })
      hudSelectedRent = hud.selectedBedroomRent
      hudStatus = hudSelectedRent ? 'completed' : 'failed'
      hudRaw = hud
      await supabase.from('listing_hud_rent_snapshots').insert({
        listing_id: listing.id,
        organization_id: organizationId,
        state: hud.state || listing.state || null,
        county: hud.county || listing.county || null,
        zip,
        bedrooms,
        hud_year: hud.hudYear,
        area_name: hud.metroArea || hud.county || null,
        fmr_0br: hud.rents[0],
        fmr_1br: hud.rents[1],
        fmr_2br: hud.rents[2],
        fmr_3br: hud.rents[3],
        fmr_4br: hud.rents[4],
        selected_fmr: hud.selectedBedroomRent,
        lookup_status: hudStatus,
        confidence_score: hud.selectedBedroomRent ? 80 : 35,
        raw_payload: hud.raw || hud,
      })
    } catch (error) {
      hudStatus = 'failed'
      hudRaw = { error: error instanceof Error ? error.message : 'HUD lookup failed' }
      await createInAppNotification(supabase, {
        organizationId,
        userId: userId || listing.created_by || null,
        actorId: userId || null,
        type: 'hud_lookup_failed',
        title: 'HUD/FMR lookup failed',
        message: `${listing.title || 'Listing'} needs manual HUD/FMR review.`,
        relatedEntityType: 'market_listing',
        relatedEntityId: listing.id,
        actionHref: `/market/${listing.id}`,
        metadata: { zip, error: (hudRaw as any).error },
      })
    }
  }

  const rent = buildRentConfidenceBreakdown(listing, hudSelectedRent)
  await supabase.from('listing_rent_estimates').insert({
    listing_id: listing.id,
    organization_id: organizationId,
    source: rent.source,
    estimated_rent: rent.estimatedRent,
    rent_low: rent.rentLow,
    rent_high: rent.rentHigh,
    confidence_score: rent.confidenceScore,
    confidence_breakdown: rent.confidenceBreakdown,
    missing_fields: rent.missingFields,
    input_snapshot: {
      trigger: params.trigger || 'auto_import',
      listingId: listing.id,
      sourceType: listing.source_type,
      zip,
      bedrooms,
      hudStatus,
      hudSelectedRent,
      hudRaw,
    },
    created_by: userId || null,
  })

  const update: Record<string, any> = {
    market_rent: listing.market_rent || rent.estimatedRent || null,
    estimated_rent: listing.estimated_rent || rent.estimatedRent || null,
    hud_rent: listing.hud_rent || hudSelectedRent || null,
    rent_confidence_score: rent.confidenceScore,
    rent_confidence_breakdown: rent.confidenceBreakdown,
    data_quality_missing_fields: rent.missingFields,
  }
  if (rent.confidenceScore < 65) {
    update.deal_status = 'low_confidence'
    update.review_reason = 'Rent intelligence needs review before opportunity promotion.'
  }
  await supabase.from('market_listings').update(update).eq('id', listing.id).eq('organization_id', organizationId)

  await recordMarketListingActivity(supabase, {
    organizationId,
    listingId: listing.id,
    actorId: userId || null,
    eventType: 'rent_analysis',
    title: 'Rent intelligence calculated',
    description: `Estimated rent ${rent.estimatedRent ? `$${rent.estimatedRent.toLocaleString()}` : 'not available'} · confidence ${rent.confidenceScore}/100`,
    metadata: { rent, hudStatus, hudSelectedRent },
  })

  if (rent.confidenceScore < 65) {
    await createInAppNotification(supabase, {
      organizationId,
      userId: userId || listing.created_by || null,
      actorId: userId || null,
      type: 'rent_analysis_failed',
      title: 'Rent analysis needs review',
      message: `${listing.title || 'Listing'} has low rent confidence and needs manual review.`,
      relatedEntityType: 'market_listing',
      relatedEntityId: listing.id,
      actionHref: `/market/${listing.id}`,
      metadata: { confidenceScore: rent.confidenceScore, missingFields: rent.missingFields },
    })
  }

  return { rent, hudStatus, hudSelectedRent }
}
