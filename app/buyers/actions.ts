'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { canUseFeature } from '@/lib/billing/features'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createInAppNotification } from '@/lib/notifications'
import { recordMarketListingActivity } from '@/lib/market/activity'

type Row = Record<string, any>

type MatchResult = {
  matchScore: number
  reasons: string[]
  risks: string[]
}

function text(formData: FormData, key: string) {
  const value = String(formData.get(key) || '').trim()
  return value || null
}

function numberValue(formData: FormData, key: string) {
  const raw = String(formData.get(key) || '').trim()
  if (!raw) return null
  const parsed = Number(raw.replace(/[$,%\s]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function integerValue(formData: FormData, key: string) {
  const value = numberValue(formData, key)
  return value === null ? null : Math.max(0, Math.round(value))
}

function listValue(formData: FormData, key: string) {
  const raw = String(formData.get(key) || '').trim()
  if (!raw) return []
  return raw
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 80)
}

function buyerStatusValue(formData: FormData) {
  const value = String(formData.get('status') || 'active')
  return ['active', 'warm', 'hot', 'paused', 'archived'].includes(value) ? value : 'active'
}

function relationshipStageValue(formData: FormData) {
  const value = String(formData.get('relationship_stage') || 'new')
  return ['new', 'qualified', 'sent_deals', 'offer_made', 'closed', 'nurture'].includes(value) ? value : 'new'
}

function buyerTypeValue(formData: FormData) {
  const value = String(formData.get('buyer_type') || 'investor')
  return ['investor', 'landlord', 'flipper', 'wholesaler', 'fund', 'agent', 'other'].includes(value) ? value : 'investor'
}

function proofOfFundsValue(formData: FormData) {
  const value = String(formData.get('proof_of_funds_status') || 'unknown')
  return ['unknown', 'requested', 'received', 'verified', 'expired'].includes(value) ? value : 'unknown'
}

function requireBuyerAccess(workspace: Awaited<ReturnType<typeof getCurrentWorkspace>>) {
  if (workspace.access.isPlatformAdmin) return
  if (canUseFeature(workspace.access.features, 'buyers') || canUseFeature(workspace.access.features, 'buyer_matching')) return
  redirect(`/buyers?error=${encodeURIComponent('Buyer CRM and buyer matching are premium features. Enable Buyers or Buyer Matching for this workspace.')}`)
}

function buyerPayload(formData: FormData, workspace: Awaited<ReturnType<typeof getCurrentWorkspace>>) {
  return {
    organization_id: workspace.organization!.id,
    created_by: workspace.user.id,
    assigned_user_id: workspace.user.id,
    buyer_type: buyerTypeValue(formData),
    status: buyerStatusValue(formData),
    relationship_stage: relationshipStageValue(formData),
    source: text(formData, 'source'),
    name: text(formData, 'name') || 'Unnamed buyer',
    company_name: text(formData, 'company_name'),
    email: text(formData, 'email'),
    phone: text(formData, 'phone'),
    financing_type: text(formData, 'financing_type'),
    proof_of_funds_status: proofOfFundsValue(formData),
    min_budget: numberValue(formData, 'min_budget'),
    max_budget: numberValue(formData, 'max_budget'),
    preferred_states: listValue(formData, 'preferred_states').map((item) => item.toUpperCase()),
    preferred_cities: listValue(formData, 'preferred_cities'),
    preferred_zip_codes: listValue(formData, 'preferred_zip_codes'),
    property_types: listValue(formData, 'property_types'),
    strategies: listValue(formData, 'strategies'),
    min_units: integerValue(formData, 'min_units'),
    max_units: integerValue(formData, 'max_units'),
    min_bedrooms: numberValue(formData, 'min_bedrooms'),
    min_bathrooms: numberValue(formData, 'min_bathrooms'),
    min_sqft: integerValue(formData, 'min_sqft'),
    min_cashflow: numberValue(formData, 'min_cashflow'),
    min_dscr: numberValue(formData, 'min_dscr'),
    min_cap_rate: numberValue(formData, 'min_cap_rate'),
    min_arv_spread: numberValue(formData, 'min_arv_spread'),
    notes: text(formData, 'notes'),
    tags: listValue(formData, 'tags'),
  }
}

function normalizedList(values: unknown) {
  return Array.isArray(values) ? values.map((value) => String(value).trim().toLowerCase()).filter(Boolean) : []
}

function dollars(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function capRatePercent(value: unknown) {
  const parsed = Number(value || 0)
  if (!Number.isFinite(parsed)) return 0
  return parsed > 1 ? parsed / 100 : parsed
}

function strategyMatches(buyerStrategies: string[], strategyFit: string | null | undefined) {
  if (!buyerStrategies.length) return true
  const fit = String(strategyFit || '').toLowerCase()
  return buyerStrategies.some((strategy) => {
    const s = strategy.toLowerCase()
    if (s.includes('section') && fit.includes('section')) return true
    if (s.includes('brrrr') && fit.includes('brrrr')) return true
    if (s.includes('flip') && fit.includes('flip')) return true
    if (s.includes('wholesale') && fit.includes('wholesale')) return true
    if ((s.includes('hold') || s.includes('rental')) && (fit.includes('hold') || fit.includes('rental'))) return true
    return fit.includes(s)
  })
}

function scoreBuyerListingMatch(buyer: Row, listing: Row, score: Row | null): MatchResult {
  let points = 20
  const reasons: string[] = []
  const risks: string[] = []

  const price = dollars(listing.list_price || listing.asking_price)
  const units = Number(listing.units || 1)
  const bedrooms = Number(listing.bedrooms || 0)
  const bathrooms = Number(listing.bathrooms || 0)
  const sqft = Number(listing.sqft || 0)
  const dealScore = Number(score?.deal_score || 0)
  const cashflow = dollars(score?.estimated_monthly_cashflow)
  const dscr = Number(score?.estimated_dscr || 0)
  const capRate = Number(score?.estimated_cap_rate || 0)
  const arvSpread = dollars(listing.arv) && price ? dollars(listing.arv) - price - dollars(listing.rehab_estimate) : 0

  const preferredStates = normalizedList(buyer.preferred_states)
  const preferredCities = normalizedList(buyer.preferred_cities)
  const preferredZips = normalizedList(buyer.preferred_zip_codes)
  const propertyTypes = normalizedList(buyer.property_types)
  const strategies = normalizedList(buyer.strategies)

  if (preferredStates.length || preferredCities.length || preferredZips.length) {
    const stateHit = preferredStates.includes(String(listing.state || '').toLowerCase())
    const cityHit = preferredCities.includes(String(listing.city || '').toLowerCase())
    const zipHit = preferredZips.includes(String(listing.zip_code || '').toLowerCase())
    if (stateHit || cityHit || zipHit) {
      points += zipHit ? 18 : cityHit ? 15 : 10
      reasons.push('Location fits buyer criteria.')
    } else {
      points -= 20
      risks.push('Location is outside buyer criteria.')
    }
  } else {
    points += 6
    reasons.push('Buyer has broad geography.')
  }

  if (propertyTypes.length) {
    const listingType = String(listing.property_type || '').toLowerCase()
    if (propertyTypes.some((type) => listingType.includes(type))) {
      points += 12
      reasons.push('Property type fits buyer demand.')
    } else {
      points -= 14
      risks.push('Property type does not match buyer criteria.')
    }
  } else {
    points += 5
  }

  if (buyer.min_budget && price && price < Number(buyer.min_budget)) {
    points -= 8
    risks.push('Price is below buyer minimum budget.')
  }
  if (buyer.max_budget && price && price > Number(buyer.max_budget)) {
    points -= 22
    risks.push('Price is above buyer max budget.')
  }
  if (price && (!buyer.max_budget || price <= Number(buyer.max_budget)) && (!buyer.min_budget || price >= Number(buyer.min_budget))) {
    points += 15
    reasons.push('Price fits buyer budget.')
  }

  if (buyer.min_units && units < Number(buyer.min_units)) {
    points -= 10
    risks.push('Too few units for this buyer.')
  } else if (buyer.min_units) {
    points += 6
  }
  if (buyer.max_units && units > Number(buyer.max_units)) {
    points -= 10
    risks.push('Too many units for this buyer.')
  } else if (buyer.max_units) {
    points += 6
  }
  if (buyer.min_bedrooms && bedrooms && bedrooms >= Number(buyer.min_bedrooms)) points += 4
  if (buyer.min_bathrooms && bathrooms && bathrooms >= Number(buyer.min_bathrooms)) points += 4
  if (buyer.min_sqft && sqft && sqft >= Number(buyer.min_sqft)) points += 4

  if (strategyMatches(strategies, score?.strategy_fit)) {
    points += strategies.length ? 10 : 4
    reasons.push('Strategy fit aligns with buyer preference.')
  } else if (strategies.length) {
    points -= 10
    risks.push('Strategy fit does not match buyer preference.')
  }

  if (buyer.min_cashflow) {
    if (cashflow >= Number(buyer.min_cashflow)) {
      points += 10
      reasons.push('Projected cashflow meets buyer target.')
    } else {
      points -= 10
      risks.push('Projected cashflow is below buyer target.')
    }
  } else if (cashflow > 0) points += 6

  if (buyer.min_dscr) {
    if (dscr >= Number(buyer.min_dscr)) {
      points += 8
      reasons.push('DSCR meets buyer target.')
    } else if (dscr) {
      points -= 8
      risks.push('DSCR is below buyer target.')
    }
  } else if (dscr >= 1.2) points += 6

  if (buyer.min_cap_rate) {
    if (capRate >= capRatePercent(buyer.min_cap_rate)) {
      points += 8
      reasons.push('Cap rate meets buyer target.')
    } else if (capRate) {
      points -= 8
      risks.push('Cap rate is below buyer target.')
    }
  } else if (capRate >= 0.07) points += 6

  if (buyer.min_arv_spread) {
    if (arvSpread >= Number(buyer.min_arv_spread)) {
      points += 8
      reasons.push('ARV spread meets buyer target.')
    } else if (arvSpread) {
      points -= 8
      risks.push('ARV spread is below buyer target.')
    }
  }

  if (dealScore >= 80) {
    points += 10
    reasons.push('DealFlowIQ score is 80+.')
  } else if (dealScore > 0 && dealScore < 65) {
    points -= 8
    risks.push('DealFlowIQ score is below strong-opportunity range.')
  }

  const matchScore = Math.max(0, Math.min(100, Math.round(points)))
  if (!reasons.length) reasons.push('Buyer has broad criteria and this listing has enough data to review.')
  return { matchScore, reasons: reasons.slice(0, 8), risks: risks.slice(0, 8) }
}

export async function createBuyerAction(formData: FormData) {
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  requireBuyerAccess(workspace)

  const payload = buyerPayload(formData, workspace)
  if (!payload.name || payload.name === 'Unnamed buyer') redirect(`/buyers?error=${encodeURIComponent('Buyer name is required.')}`)

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('buyers').insert(payload).select('id').single()
  if (error || !data) redirect(`/buyers?error=${encodeURIComponent(error?.message || 'Could not create buyer')}`)

  await supabase.from('audit_logs').insert({
    organization_id: workspace.organization.id,
    actor_id: workspace.user.id,
    event_type: 'buyer.created',
    entity_type: 'buyer',
    entity_id: data.id,
    metadata: { name: payload.name, buyer_type: payload.buyer_type },
  })

  revalidatePath('/buyers')
  redirect('/buyers?saved=buyer_created')
}

export async function updateBuyerAction(formData: FormData) {
  const buyerId = String(formData.get('buyer_id') || '').trim()
  if (!buyerId) redirect('/buyers?error=Missing buyer id')
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  requireBuyerAccess(workspace)

  const payload: Row = buyerPayload(formData, workspace)
  delete payload.organization_id
  delete payload.created_by
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('buyers')
    .update(payload)
    .eq('id', buyerId)
    .eq('organization_id', workspace.organization.id)
  if (error) redirect(`/buyers?error=${encodeURIComponent(error.message)}`)

  revalidatePath('/buyers')
  redirect('/buyers?saved=buyer_updated')
}

export async function archiveBuyerAction(formData: FormData) {
  const buyerId = String(formData.get('buyer_id') || '').trim()
  if (!buyerId) redirect('/buyers?error=Missing buyer id')
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  requireBuyerAccess(workspace)
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('buyers')
    .update({ status: 'archived', archived_at: new Date().toISOString() })
    .eq('id', buyerId)
    .eq('organization_id', workspace.organization.id)
  if (error) redirect(`/buyers?error=${encodeURIComponent(error.message)}`)
  revalidatePath('/buyers')
  redirect('/buyers?saved=buyer_archived')
}

export async function createBuyerInteractionAction(formData: FormData) {
  const buyerId = String(formData.get('buyer_id') || '').trim()
  if (!buyerId) redirect('/buyers?error=Missing buyer id')
  const summary = text(formData, 'summary')
  if (!summary) redirect('/buyers?error=Interaction note is required')
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  requireBuyerAccess(workspace)
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase.from('buyer_interactions').insert({
    organization_id: workspace.organization.id,
    buyer_id: buyerId,
    listing_id: text(formData, 'listing_id'),
    deal_id: text(formData, 'deal_id'),
    created_by: workspace.user.id,
    interaction_type: text(formData, 'interaction_type') || 'note',
    direction: text(formData, 'direction') || 'internal',
    summary,
    next_follow_up_at: text(formData, 'next_follow_up_at'),
  })
  if (error) redirect(`/buyers?error=${encodeURIComponent(error.message)}`)

  await supabase.from('buyers').update({ last_contacted_at: new Date().toISOString() }).eq('id', buyerId).eq('organization_id', workspace.organization.id)
  revalidatePath('/buyers')
  redirect('/buyers?saved=interaction_added')
}

export async function runBuyerMatchingAction(formData: FormData) {
  const requestedBuyerId = String(formData.get('buyer_id') || '').trim()
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  requireBuyerAccess(workspace)
  if (!canUseFeature(workspace.access.features, 'buyer_matching') && !workspace.access.isPlatformAdmin) {
    redirect(`/buyers?error=${encodeURIComponent('Buyer matching is not enabled for this workspace.')}`)
  }

  const supabase = await createSupabaseServerClient()
  let buyersQuery = supabase
    .from('buyers')
    .select('*')
    .eq('organization_id', workspace.organization.id)
    .in('status', ['active', 'warm', 'hot'])
    .limit(100)
  if (requestedBuyerId) buyersQuery = buyersQuery.eq('id', requestedBuyerId)

  const [{ data: buyers, error: buyersError }, { data: listings, error: listingsError }] = await Promise.all([
    buyersQuery,
    supabase
      .from('market_listings')
      .select('*')
      .eq('organization_id', workspace.organization.id)
      .in('status', ['active', 'opportunity', 'needs_review'])
      .order('created_at', { ascending: false })
      .limit(250),
  ])

  if (buyersError) redirect(`/buyers?error=${encodeURIComponent(buyersError.message)}`)
  if (listingsError) redirect(`/buyers?error=${encodeURIComponent(listingsError.message)}`)

  const listingIds = (listings || []).map((listing: Row) => listing.id).filter(Boolean)
  const { data: scores } = listingIds.length
    ? await supabase.from('market_listing_scores').select('*').in('listing_id', listingIds).order('calculated_at', { ascending: false }).limit(500)
    : { data: [] as Row[] }

  const scoreByListing = new Map<string, Row>()
  for (const score of scores || []) {
    const listingId = String((score as Row).listing_id)
    if (!scoreByListing.has(listingId)) scoreByListing.set(listingId, score as Row)
  }

  let createdOrUpdated = 0
  const rows: Row[] = []
  for (const buyer of buyers || []) {
    for (const listing of listings || []) {
      const score = scoreByListing.get(String((listing as Row).id)) || null
      const result = scoreBuyerListingMatch(buyer as Row, listing as Row, score)
      if (result.matchScore < 55) continue
      rows.push({
        organization_id: workspace.organization.id,
        buyer_id: (buyer as Row).id,
        listing_id: (listing as Row).id,
        match_score: result.matchScore,
        status: result.matchScore >= 80 ? 'review' : 'auto_matched',
        reasons: result.reasons,
        risks: result.risks,
        matched_at: new Date().toISOString(),
      })
    }
  }

  for (const row of rows.slice(0, 1000)) {
    const { data: existingMatch } = await supabase
      .from('buyer_deal_matches')
      .select('id')
      .eq('buyer_id', row.buyer_id)
      .eq('listing_id', row.listing_id)
      .maybeSingle()

    const { error } = existingMatch?.id
      ? await supabase
          .from('buyer_deal_matches')
          .update({
            match_score: row.match_score,
            status: row.status,
            reasons: row.reasons,
            risks: row.risks,
            matched_at: row.matched_at,
          })
          .eq('id', existingMatch.id)
      : await supabase.from('buyer_deal_matches').insert(row)

    if (!error) {
      createdOrUpdated += 1
      if (Number(row.match_score || 0) >= 80) {
        await createInAppNotification(supabase, {
          organizationId: workspace.organization.id,
          userId: workspace.user.id,
          actorId: workspace.user.id,
          type: 'buyer_match',
          title: 'Strong buyer match found',
          message: `A buyer matched a listing with ${Math.round(Number(row.match_score || 0))}/100 fit.`,
          relatedEntityType: 'market_listing',
          relatedEntityId: row.listing_id,
          actionHref: `/market/${row.listing_id}`,
          metadata: { buyerId: row.buyer_id, matchScore: row.match_score },
        })
        await recordMarketListingActivity(supabase, {
          organizationId: workspace.organization.id,
          listingId: row.listing_id,
          actorId: workspace.user.id,
          eventType: 'buyer_matched',
          title: 'Buyer matched',
          description: `Buyer match score ${Math.round(Number(row.match_score || 0))}/100.`,
          metadata: { buyerId: row.buyer_id, matchScore: row.match_score, status: row.status },
        })
      }
    }
  }

  await supabase.from('audit_logs').insert({
    organization_id: workspace.organization.id,
    actor_id: workspace.user.id,
    event_type: 'buyer_matching.run',
    entity_type: requestedBuyerId ? 'buyer' : 'buyer_deal_matches',
    entity_id: requestedBuyerId || null,
    metadata: { buyers: (buyers || []).length, listings: (listings || []).length, matches: createdOrUpdated },
  })

  revalidatePath('/buyers')
  redirect(`/buyers?saved=matching_run&matches=${createdOrUpdated}`)
}
