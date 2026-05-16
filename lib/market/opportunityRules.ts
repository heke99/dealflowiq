export const STRONG_OPPORTUNITY_SCORE_THRESHOLD = 85
export const STRONG_OPPORTUNITY_RENT_CONFIDENCE_THRESHOLD = 65
export const OPPORTUNITY_SCORE_THRESHOLD = 70
export const OPPORTUNITY_RENT_CONFIDENCE_THRESHOLD = 50
export const WATCHLIST_SCORE_THRESHOLD = 60
export const NEEDS_REVIEW_SCORE_THRESHOLD = 60
export const NEEDS_REVIEW_CONFIDENCE_THRESHOLD = 60

export type OpportunityRank = 'strong_opportunity' | 'opportunity' | 'watchlist' | 'needs_review' | 'market_only'

export function classifyOpportunity(scoreInput: unknown, rentConfidenceInput: unknown, hasMissingData = false): { rank: OpportunityRank; label: string; isOpportunity: boolean; isStrongOpportunity: boolean; shouldWatchlist: boolean; shouldNeedsReview: boolean; reason: string } {
  const score = Number(scoreInput || 0)
  const rentConfidence = Number(rentConfidenceInput || 0)

  if (score >= STRONG_OPPORTUNITY_SCORE_THRESHOLD && rentConfidence >= STRONG_OPPORTUNITY_RENT_CONFIDENCE_THRESHOLD) {
    return {
      rank: 'strong_opportunity',
      label: 'Strong Opportunity',
      isOpportunity: true,
      isStrongOpportunity: true,
      shouldWatchlist: true,
      shouldNeedsReview: false,
      reason: `Score ${Math.round(score)} and rent confidence ${Math.round(rentConfidence)} meet Strong Opportunity rules.`,
    }
  }

  if (score >= OPPORTUNITY_SCORE_THRESHOLD && rentConfidence >= OPPORTUNITY_RENT_CONFIDENCE_THRESHOLD) {
    return {
      rank: 'opportunity',
      label: 'Opportunity',
      isOpportunity: true,
      isStrongOpportunity: false,
      shouldWatchlist: true,
      shouldNeedsReview: false,
      reason: `Score ${Math.round(score)} and rent confidence ${Math.round(rentConfidence)} meet Opportunity rules.`,
    }
  }

  if (score >= NEEDS_REVIEW_SCORE_THRESHOLD && rentConfidence < NEEDS_REVIEW_CONFIDENCE_THRESHOLD) {
    return {
      rank: 'needs_review',
      label: 'Needs Review',
      isOpportunity: false,
      isStrongOpportunity: false,
      shouldWatchlist: true,
      shouldNeedsReview: true,
      reason: `Score ${Math.round(score)} is promising, but rent confidence ${Math.round(rentConfidence)} needs review.`,
    }
  }

  if (score >= WATCHLIST_SCORE_THRESHOLD || hasMissingData) {
    return {
      rank: 'watchlist',
      label: 'Watchlist',
      isOpportunity: false,
      isStrongOpportunity: false,
      shouldWatchlist: true,
      shouldNeedsReview: hasMissingData,
      reason: hasMissingData ? 'Listing has missing data and should stay on the watchlist until reviewed.' : `Score ${Math.round(score)} meets Watchlist rules.`,
    }
  }

  return {
    rank: 'market_only',
    label: 'Market Only',
    isOpportunity: false,
    isStrongOpportunity: false,
    shouldWatchlist: false,
    shouldNeedsReview: false,
    reason: 'Listing does not meet Watchlist or Opportunity rules yet.',
  }
}
