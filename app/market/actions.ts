'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { canUseFeature } from '@/lib/billing/features'
import { scoreMarketListing, normalizePropertyType } from '@/lib/market/scoring'

function text(formData: FormData, key: string) {
  const value = String(formData.get(key) || '').trim()
  return value || null
}

function numberValue(formData: FormData, key: string) {
  const raw = String(formData.get(key) || '').trim()
  if (!raw) return null
  const parsed = Number(raw.replace(/[$,\s]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function integerValue(formData: FormData, key: string) {
  const value = numberValue(formData, key)
  return value === null ? null : Math.max(1, Math.round(value))
}

function sourceTypeValue(formData: FormData) {
  const value = String(formData.get('source_type') || 'manual')
  return ['manual', 'zillow', 'crexi', 'loopnet', 'redfin', 'realtor', 'apartments', 'csv', 'partner_api', 'mls_feed', 'public_deal', 'community_deal', 'other'].includes(value) ? value : 'manual'
}

function visibilityValue(formData: FormData) {
  const value = String(formData.get('visibility') || 'private')
  return value === 'team' || value === 'community' || value === 'public' ? value : 'private'
}

function imageUrlsValue(formData: FormData) {
  const raw = String(formData.get('image_urls') || '').trim()
  if (!raw) return []
  return raw
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter((item) => item.startsWith('http://') || item.startsWith('https://'))
    .slice(0, 12)
}

async function insertScoreForListing(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, listing: Record<string, any>, organizationId: string | null) {
  const score = scoreMarketListing(listing)
  await supabase.from('market_listing_scores').insert({
    listing_id: listing.id,
    organization_id: organizationId,
    formula_version: 'market-score-v1',
    deal_score: score.dealScore,
    risk_score: score.riskScore,
    risk_level: score.riskLevel,
    data_confidence: score.dataConfidence,
    strategy_fit: score.strategyFit,
    estimated_noi: score.estimatedNoi,
    estimated_cashflow: score.estimatedCashflow,
    estimated_monthly_cashflow: score.estimatedMonthlyCashflow,
    estimated_dscr: score.estimatedDscr,
    estimated_cap_rate: score.estimatedCapRate,
    hud_rent: score.hudRent || null,
    market_rent: score.marketRent || null,
    rent_gap: score.rentGap,
    hud_rent_gap: score.hudRentGap,
    break_even_rent: score.breakEvenRent,
    reasons: score.reasons,
    risks: score.risks,
    missing_fields: score.missingFields,
  })
}

export async function createMarketListingAction(formData: FormData) {
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')

  const sourceUrl = text(formData, 'source_url')
  const title = text(formData, 'title') || text(formData, 'address') || 'Untitled opportunity'
  const imageUrls = imageUrlsValue(formData)
  const listingPayload = {
    organization_id: workspace.organization.id,
    created_by: workspace.user.id,
    source_type: sourceTypeValue(formData),
    external_listing_id: text(formData, 'external_listing_id'),
    source_url: sourceUrl,
    title,
    address: text(formData, 'address'),
    city: text(formData, 'city'),
    state: text(formData, 'state'),
    zip_code: text(formData, 'zip_code'),
    county: text(formData, 'county'),
    property_type: normalizePropertyType(text(formData, 'property_type')),
    units: integerValue(formData, 'units') || 1,
    bedrooms: numberValue(formData, 'bedrooms'),
    bathrooms: numberValue(formData, 'bathrooms'),
    sqft: integerValue(formData, 'sqft'),
    lot_size: text(formData, 'lot_size'),
    year_built: integerValue(formData, 'year_built'),
    list_price: numberValue(formData, 'list_price') || numberValue(formData, 'asking_price'),
    asking_price: numberValue(formData, 'asking_price') || numberValue(formData, 'list_price'),
    arv: numberValue(formData, 'arv'),
    rehab_estimate: numberValue(formData, 'rehab_estimate'),
    current_rent: numberValue(formData, 'current_rent'),
    market_rent: numberValue(formData, 'market_rent'),
    hud_rent: numberValue(formData, 'hud_rent'),
    estimated_rent: numberValue(formData, 'estimated_rent'),
    taxes_annual: numberValue(formData, 'taxes_annual'),
    insurance_annual: numberValue(formData, 'insurance_annual'),
    hoa_monthly: numberValue(formData, 'hoa_monthly'),
    utilities_monthly: numberValue(formData, 'utilities_monthly'),
    description: text(formData, 'description'),
    broker_name: text(formData, 'broker_name'),
    broker_phone: text(formData, 'broker_phone'),
    broker_email: text(formData, 'broker_email'),
    primary_image_url: text(formData, 'primary_image_url') || imageUrls[0] || null,
    image_urls: imageUrls,
    visibility: visibilityValue(formData),
    status: 'active',
    raw_payload: { source: 'manual_market_entry', createdAt: new Date().toISOString() },
  }

  const supabase = await createSupabaseServerClient()

  if (sourceUrl) {
    const { data: existing } = await supabase
      .from('market_listings')
      .select('id')
      .eq('organization_id', workspace.organization.id)
      .eq('source_url', sourceUrl)
      .maybeSingle()
    if (existing?.id) redirect(`/market?tab=all&error=${encodeURIComponent('That source URL already exists in Market.')}`)
  }

  const { data: listing, error } = await supabase.from('market_listings').insert(listingPayload).select('*').single()
  if (error || !listing) redirect(`/market?tab=sources&error=${encodeURIComponent(error?.message || 'Could not create market listing')}`)

  await insertScoreForListing(supabase, listing as any, workspace.organization.id)
  await supabase.from('audit_logs').insert({
    organization_id: workspace.organization.id,
    actor_id: workspace.user.id,
    event_type: 'market_listing.created',
    entity_type: 'market_listing',
    entity_id: listing.id,
    metadata: { source_type: listing.source_type, source_url: listing.source_url },
  })

  revalidatePath('/market')
  redirect('/market?tab=all&saved=listing')
}

export async function rescoreMarketListingAction(formData: FormData) {
  const listingId = String(formData.get('listing_id') || '').trim()
  if (!listingId) redirect('/market?error=Missing listing id')
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  const supabase = await createSupabaseServerClient()
  const { data: listing, error } = await supabase
    .from('market_listings')
    .select('*')
    .eq('id', listingId)
    .maybeSingle()
  if (error || !listing) redirect(`/market?error=${encodeURIComponent(error?.message || 'Listing not found')}`)
  await insertScoreForListing(supabase, listing as any, (listing as any).organization_id || workspace.organization.id)
  revalidatePath('/market')
  redirect('/market?tab=opportunities&saved=rescore')
}

export async function saveOpportunityAction(formData: FormData) {
  const listingId = String(formData.get('listing_id') || '').trim()
  const status = String(formData.get('status') || 'saved')
  const safeStatus = ['saved', 'watching', 'ignored', 'contacted', 'passed'].includes(status) ? status : 'saved'
  if (!listingId) redirect('/market?error=Missing listing id')
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.from('market_watchlist').upsert({
    organization_id: workspace.organization.id,
    user_id: workspace.user.id,
    listing_id: listingId,
    status: safeStatus,
  }, { onConflict: 'organization_id,user_id,listing_id' })
  if (error) redirect(`/market?error=${encodeURIComponent(error.message)}`)
  revalidatePath('/market')
  redirect(`/market?tab=${safeStatus === 'ignored' || safeStatus === 'passed' ? 'ignored' : 'saved'}&saved=${safeStatus}`)
}

export async function convertListingToDealAction(formData: FormData) {
  const listingId = String(formData.get('listing_id') || '').trim()
  if (!listingId) redirect('/market?error=Missing listing id')
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  const supabase = await createSupabaseServerClient()
  const { data: listing, error: listingError } = await supabase
    .from('market_listings')
    .select('*')
    .eq('id', listingId)
    .maybeSingle()
  if (listingError || !listing) redirect(`/market?error=${encodeURIComponent(listingError?.message || 'Listing not found')}`)

  const row = listing as any
  const { data: deal, error: dealError } = await supabase.from('deals').insert({
    organization_id: workspace.organization.id,
    created_by: workspace.user.id,
    assigned_user_id: workspace.user.id,
    title: row.title || row.address || 'Market opportunity',
    status: 'imported',
    source_url: row.source_url,
    source_platform: row.source_type,
    primary_image_url: row.primary_image_url,
    image_urls: row.image_urls || [],
    visibility: 'private',
    property_type: row.property_type,
    asking_price: row.asking_price || row.list_price,
    purchase_price: row.list_price || row.asking_price,
    arv: row.arv,
    rehab_estimate: row.rehab_estimate,
    current_rent: row.current_rent || row.estimated_rent,
    market_rent: row.market_rent,
    section8_rent: row.hud_rent,
    taxes_annual: row.taxes_annual,
    insurance_annual: row.insurance_annual,
    hoa_monthly: row.hoa_monthly,
    utilities_monthly: row.utilities_monthly,
    notes: row.description,
  }).select('id').single()
  if (dealError || !deal) redirect(`/market?error=${encodeURIComponent(dealError?.message || 'Could not convert listing')}`)

  const { error: propertyError } = await supabase.from('properties').insert({
    organization_id: workspace.organization.id,
    deal_id: deal.id,
    address: row.address,
    city: row.city,
    state: row.state,
    zip_code: row.zip_code,
    county: row.county,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    square_feet: row.sqft,
    lot_size: row.lot_size,
    year_built: row.year_built,
    number_of_units: row.units || 1,
  })
  if (propertyError) redirect(`/deals/${deal.id}/edit?error=${encodeURIComponent(propertyError.message)}`)

  await supabase.from('market_watchlist').upsert({
    organization_id: workspace.organization.id,
    user_id: workspace.user.id,
    listing_id: listingId,
    status: 'converted_to_deal',
  }, { onConflict: 'organization_id,user_id,listing_id' })
  await supabase.from('market_listings').update({ status: 'converted_to_deal' }).eq('id', listingId)

  revalidatePath('/market')
  revalidatePath('/deals')
  redirect(`/deals/${deal.id}?saved=converted`)
}

export async function publishDealToMarketAction(formData: FormData) {
  const dealId = String(formData.get('deal_id') || '').trim()
  if (!dealId) redirect('/deals?error=Missing deal id')
  const visibility = visibilityValue(formData)
  if (visibility === 'private') redirect(`/deals/${dealId}?error=${encodeURIComponent('Choose Team, Community, or Public to publish a deal.')}`)
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  if ((visibility === 'community' || visibility === 'public') && !canUseFeature(workspace.access.features, 'public_community_deals')) {
    redirect(`/deals/${dealId}?error=${encodeURIComponent('Public/community deal posting is a premium feature.')}`)
  }
  const supabase = await createSupabaseServerClient()
  const { data: deal, error: dealError } = await supabase
    .from('deals')
    .select('*, properties(*)')
    .eq('id', dealId)
    .eq('organization_id', workspace.organization.id)
    .maybeSingle()
  if (dealError || !deal) redirect(`/deals/${dealId}?error=${encodeURIComponent(dealError?.message || 'Deal not found')}`)
  const property = Array.isArray((deal as any).properties) ? (deal as any).properties[0] : (deal as any).properties
  const { error: updateError } = await supabase.from('deals').update({
    visibility,
    published_at: new Date().toISOString(),
  }).eq('id', dealId).eq('organization_id', workspace.organization.id)
  if (updateError) redirect(`/deals/${dealId}?error=${encodeURIComponent(updateError.message)}`)

  const title = text(formData, 'title') || (deal as any).title
  await supabase.from('public_deal_posts').insert({
    deal_id: dealId,
    organization_id: workspace.organization.id,
    created_by: workspace.user.id,
    visibility,
    title,
    summary: text(formData, 'summary') || (deal as any).notes,
    asking_price: numberValue(formData, 'asking_price') || (deal as any).asking_price || (deal as any).purchase_price,
    assignment_fee: numberValue(formData, 'assignment_fee'),
    contact_name: text(formData, 'contact_name'),
    contact_email: text(formData, 'contact_email') || workspace.user.email,
    contact_phone: text(formData, 'contact_phone'),
    status: 'published',
    published_at: new Date().toISOString(),
  })

  const listingPayload = {
    organization_id: workspace.organization.id,
    created_by: workspace.user.id,
    source_type: visibility === 'community' ? 'community_deal' : 'public_deal',
    source_url: (deal as any).source_url,
    title,
    address: property?.address,
    city: property?.city,
    state: property?.state,
    zip_code: property?.zip_code,
    county: property?.county,
    property_type: (deal as any).property_type,
    units: property?.number_of_units || 1,
    bedrooms: property?.bedrooms,
    bathrooms: property?.bathrooms,
    sqft: property?.square_feet,
    lot_size: property?.lot_size,
    year_built: property?.year_built,
    list_price: (deal as any).asking_price || (deal as any).purchase_price,
    asking_price: (deal as any).asking_price || (deal as any).purchase_price,
    arv: (deal as any).arv,
    rehab_estimate: (deal as any).rehab_estimate,
    current_rent: (deal as any).current_rent,
    market_rent: (deal as any).market_rent,
    hud_rent: (deal as any).section8_rent,
    taxes_annual: (deal as any).taxes_annual,
    insurance_annual: (deal as any).insurance_annual,
    hoa_monthly: (deal as any).hoa_monthly,
    utilities_monthly: (deal as any).utilities_monthly,
    description: text(formData, 'summary') || (deal as any).notes,
    primary_image_url: (deal as any).primary_image_url,
    image_urls: (deal as any).image_urls || [],
    visibility,
    status: 'active',
    raw_payload: { source: 'published_deal', dealId, createdAt: new Date().toISOString() },
  }
  const { data: listing } = await supabase.from('market_listings').insert(listingPayload).select('*').single()
  if (listing?.id) await insertScoreForListing(supabase, listing as any, workspace.organization.id)

  revalidatePath('/market')
  revalidatePath(`/deals/${dealId}`)
  redirect(`/market?tab=${visibility === 'public' ? 'public' : visibility === 'community' ? 'community' : 'all'}&saved=published`)
}
