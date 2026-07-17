'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { canUseFeature } from '@/lib/billing/features'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createInAppNotification } from '@/lib/notifications'
import { recordMarketListingActivity } from '@/lib/market/activity'
import { asRows, rowString, type Row } from '@/lib/types/rows'
import { BUYER_MATCH_PERSIST_SCORE, BUYER_MATCH_REVIEW_SCORE, scoreBuyerListingMatch } from '@/lib/matching/buyerListingMatch'

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

function interactionTypeValue(formData: FormData) {
  const value = String(formData.get('interaction_type') || 'note')
  return ['note', 'call', 'email', 'sms', 'meeting', 'deal_sent', 'offer', 'follow_up'].includes(value) ? value : 'note'
}

function requireBuyerAccess(workspace: Awaited<ReturnType<typeof getCurrentWorkspace>>) {
  if (workspace.access.isPlatformAdmin) return
  if (canUseFeature(workspace.access.features, 'buyers') || canUseFeature(workspace.access.features, 'buyer_matching')) return
  redirect(`/buyers?error=BUYER_ACTION_FAILED`)
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

export async function createBuyerAction(formData: FormData) {
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  requireBuyerAccess(workspace)

  const payload = buyerPayload(formData, workspace)
  if (!payload.name || payload.name === 'Unnamed buyer') redirect(`/buyers?error=BUYER_ACTION_FAILED`)

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('buyers').insert(payload).select('id').single()
  if (error || !data) redirect(`/buyers?error=BUYER_ACTION_FAILED`)

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
  if (error) redirect(`/buyers?error=BUYER_ACTION_FAILED`)

  await supabase.from('audit_logs').insert({
    organization_id: workspace.organization.id,
    actor_id: workspace.user.id,
    event_type: 'buyer.updated',
    entity_type: 'buyer',
    entity_id: buyerId,
    metadata: { name: payload.name, buyer_type: payload.buyer_type, status: payload.status },
  })

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
  if (error) redirect(`/buyers?error=BUYER_ACTION_FAILED`)
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

  const { data: buyer, error: buyerError } = await supabase
    .from('buyers')
    .select('id')
    .eq('id', buyerId)
    .eq('organization_id', workspace.organization.id)
    .maybeSingle()
  if (buyerError) redirect(`/buyers?error=BUYER_ACTION_FAILED`)
  if (!buyer?.id) redirect(`/buyers?error=BUYER_ACTION_FAILED`)

  const { error } = await supabase.from('buyer_interactions').insert({
    organization_id: workspace.organization.id,
    buyer_id: buyerId,
    listing_id: text(formData, 'listing_id'),
    deal_id: text(formData, 'deal_id'),
    created_by: workspace.user.id,
    interaction_type: interactionTypeValue(formData),
    direction: text(formData, 'direction') || 'internal',
    summary,
    next_follow_up_at: text(formData, 'next_follow_up_at'),
  })
  if (error) redirect(`/buyers?error=BUYER_ACTION_FAILED`)

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
    redirect(`/buyers?error=BUYER_ACTION_FAILED`)
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

  if (buyersError) redirect(`/buyers?error=BUYER_ACTION_FAILED`)
  if (listingsError) redirect(`/buyers?error=BUYER_ACTION_FAILED`)

  const listingIds = (listings || []).map((listing: Row) => listing.id).filter(Boolean)
  const { data: scores } = listingIds.length
    ? await supabase.from('market_listing_scores').select('*').in('listing_id', listingIds).order('deal_score', { ascending: false }).order('calculated_at', { ascending: false }).limit(500)
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
      if (result.matchScore < BUYER_MATCH_PERSIST_SCORE) continue
      rows.push({
        organization_id: workspace.organization.id,
        buyer_id: (buyer as Row).id,
        listing_id: (listing as Row).id,
        match_score: result.matchScore,
        status: result.matchScore >= BUYER_MATCH_REVIEW_SCORE ? 'review' : 'auto_matched',
        reasons: result.reasons,
        risks: result.risks,
        matched_at: new Date().toISOString(),
      })
    }
  }

  // Snapshot stored matches before upserting so notifications only fire for new or clearly improved matches.
  const existingByPair = new Map<string, { id: string; matchScore: number }>()
  const existingPageSize = 1000
  for (let page = 0; page < 10; page += 1) {
    const { data: existingMatches, error: existingError } = await supabase
      .from('buyer_deal_matches')
      .select('id, buyer_id, listing_id, match_score')
      .eq('organization_id', workspace.organization.id)
      .not('listing_id', 'is', null)
      .range(page * existingPageSize, page * existingPageSize + existingPageSize - 1)
    if (existingError) redirect(`/buyers?error=BUYER_ACTION_FAILED`)
    const pageRows = asRows(existingMatches)
    for (const match of pageRows) {
      existingByPair.set(`${match.buyer_id}:${match.listing_id}`, { id: String(match.id), matchScore: Number(match.match_score || 0) })
    }
    if (pageRows.length < existingPageSize) break
  }

  for (const row of rows.slice(0, 1000)) {
    const existingMatch = existingByPair.get(`${row.buyer_id}:${row.listing_id}`) || null

    const { error } = existingMatch
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
      const isNewMatch = !existingMatch
      const improvedEnough = existingMatch ? Number(row.match_score || 0) >= existingMatch.matchScore + 5 : false
      if (Number(row.match_score || 0) >= BUYER_MATCH_REVIEW_SCORE && (isNewMatch || improvedEnough)) {
        await createInAppNotification(supabase, {
          organizationId: workspace.organization.id,
          userId: workspace.user.id,
          actorId: workspace.user.id,
          type: 'buyer_match',
          title: 'Strong buyer match found',
          message: `A buyer matched a listing with ${Math.round(Number(row.match_score || 0))}/100 fit.`,
          relatedEntityType: 'market_listing',
          relatedEntityId: rowString(row.listing_id),
          actionHref: `/market/${row.listing_id}`,
          metadata: { buyerId: row.buyer_id, matchScore: row.match_score },
        })
        await recordMarketListingActivity(supabase, {
          organizationId: workspace.organization.id,
          listingId: String(row.listing_id),
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
