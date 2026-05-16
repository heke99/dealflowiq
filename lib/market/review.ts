import type { MarketSourceType } from '@/lib/market/sourceConnectors'
import { classifyOpportunity } from '@/lib/market/opportunityRules'

type ScoreLike = Record<string, any>
type ListingLike = Record<string, any>

export type DealReviewStatus = 'ready' | 'needs_review' | 'missing_data' | 'low_confidence' | 'archived'

export function dealStatusLabel(status: string | null | undefined) {
  const value = String(status || 'needs_review')
  if (value === 'ready') return 'Ready'
  if (value === 'missing_data') return 'Missing data'
  if (value === 'low_confidence') return 'Low confidence'
  if (value === 'archived') return 'Archived'
  return 'Needs review'
}

export function determineDealReviewStatus(score: ScoreLike | null | undefined, listing?: ListingLike | null): { dealStatus: DealReviewStatus; reviewReason: string; listingStatus: string; why: string } {
  const currentListingStatus = String(listing?.status || '')
  if (currentListingStatus === 'archived') {
    return { dealStatus: 'archived', reviewReason: 'Listing is archived.', listingStatus: 'archived', why: 'This listing is archived and should not be promoted until restored.' }
  }

  const dealScore = Number(score?.dealScore ?? score?.deal_score ?? 0)
  const rentConfidence = Number(score?.rentConfidenceScore ?? score?.rent_confidence_score ?? 0)
  const sourceConfidence = Number(score?.sourceConfidenceScore ?? score?.source_confidence_score ?? 0)
  const missingFields = Array.isArray(score?.missingFields) ? score?.missingFields : Array.isArray(score?.missing_fields) ? score?.missing_fields : []
  const cashflow = Number(score?.estimatedMonthlyCashflow ?? score?.estimated_monthly_cashflow ?? 0)
  const dscr = Number(score?.estimatedDscr ?? score?.estimated_dscr ?? 0)
  const capRate = Number(score?.estimatedCapRate ?? score?.estimated_cap_rate ?? 0)

  if (missingFields.length >= 4 || (!listing?.list_price && !listing?.asking_price)) {
    return {
      dealStatus: 'missing_data',
      reviewReason: 'Important underwriting fields are missing.',
      listingStatus: 'needs_review',
      why: 'This deal needs review because required price, rent, expense or property data is incomplete.',
    }
  }

  const rank = classifyOpportunity(dealScore, rentConfidence, missingFields.length > 0)

  if (rank.isOpportunity) {
    const strengths = []
    if (cashflow > 0) strengths.push('estimated cashflow is positive')
    if (dscr >= 1.2) strengths.push('DSCR looks bankable')
    if (capRate >= 0.07) strengths.push('cap rate is above a common investor target')
    const reason = strengths.length ? strengths.slice(0, 2).join(' and ') : rank.reason
    return {
      dealStatus: 'ready',
      reviewReason: rank.reason,
      listingStatus: 'opportunity',
      why: `${rank.label}: this deal ranks well because ${reason}. Verify source data before making an offer.`,
    }
  }

  if (rank.shouldNeedsReview || sourceConfidence < 45 || rentConfidence < 50) {
    return {
      dealStatus: 'low_confidence',
      reviewReason: rank.reason,
      listingStatus: 'needs_review',
      why: 'This deal needs review because the score is interesting but rent/source confidence or imported data is not strong enough yet.',
    }
  }

  if (rank.shouldWatchlist) {
    return {
      dealStatus: 'needs_review',
      reviewReason: rank.reason,
      listingStatus: currentListingStatus === 'converted_to_deal' ? 'converted_to_deal' : 'active',
      why: 'This listing belongs on the watchlist until inputs, rent confidence or underwriting assumptions improve.',
    }
  }

  return {
    dealStatus: 'needs_review',
    reviewReason: 'Deal does not meet Watchlist or Opportunity gates yet.',
    listingStatus: currentListingStatus === 'converted_to_deal' ? 'converted_to_deal' : 'active',
    why: 'This listing is worth keeping in Market, but it needs a stronger score, better rent confidence, or cleaner assumptions before promotion.',
  }
}

export function inferImportMode(sourceType: MarketSourceType | string, isSearchUrl: boolean) {
  if (isSearchUrl) return 'search_url'
  if (sourceType === 'csv') return 'csv'
  if (sourceType === 'partner_api' || sourceType === 'mls_feed') return 'feed'
  return 'listing_url'
}
