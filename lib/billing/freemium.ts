import type { WorkspaceAccess } from '@/lib/billing/access'
import type { createSupabaseServerClient } from '@/lib/supabase/server'

export const FREE_OPPORTUNITY_LIST_LIMIT = 2
export const FREE_OPPORTUNITY_DETAIL_COOLDOWN_HOURS = 48

export function hasFullOpportunityAccess(access: WorkspaceAccess) {
  return ['platform_admin', 'user_override', 'subscription', 'trial'].includes(access.accessSource)
}

export function opportunityListLimit(access: WorkspaceAccess) {
  if (hasFullOpportunityAccess(access)) return null
  return Number(access.limits.max_visible_opportunities ?? FREE_OPPORTUNITY_LIST_LIMIT)
}

export async function getNextFreeOpportunityDetailUnlock(params: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>
  userId: string
  access: WorkspaceAccess
}) {
  if (hasFullOpportunityAccess(params.access)) return { allowed: true, nextUnlockAt: null as string | null, lastViewedAt: null as string | null }
  const cooldownHours = Number(params.access.limits.opportunity_detail_cooldown_hours ?? FREE_OPPORTUNITY_DETAIL_COOLDOWN_HOURS)
  const { data } = await params.supabase
    .from('user_listing_detail_views')
    .select('viewed_at')
    .eq('user_id', params.userId)
    .order('viewed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const lastViewedAt = (data as any)?.viewed_at || null
  if (!lastViewedAt) return { allowed: true, nextUnlockAt: null, lastViewedAt }
  const next = new Date(new Date(lastViewedAt).getTime() + cooldownHours * 60 * 60 * 1000)
  return { allowed: next.getTime() <= Date.now(), nextUnlockAt: next.toISOString(), lastViewedAt }
}

export async function recordOpportunityDetailView(params: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>
  userId: string
  organizationId?: string | null
  listingId: string
  access: WorkspaceAccess
}) {
  if (hasFullOpportunityAccess(params.access)) return
  await params.supabase.from('user_listing_detail_views').insert({
    user_id: params.userId,
    organization_id: params.organizationId || null,
    listing_id: params.listingId,
  })
}

export function lockedPremiumText() {
  return 'Free users can browse market listings, view 2 opportunities and open 1 full opportunity detail every 2 days. Upgrade to Pro to unlock score, calculators, DSCR, cashflow, projections and imports.'
}
