/**
 * Shared import guard helpers used by every market import entry point
 * (interactive actions, batch preview flow and the scheduled import runner).
 *
 * All three guards accept both the RLS-scoped server client and the service
 * role admin client so the scheduled worker can enforce the same provider
 * policy, hourly rate limit and plan quota rules as interactive imports.
 */
import { providerPolicyFromRow } from '@/lib/market/providerPolicies'
import type { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { createSupabaseServerClient } from '@/lib/supabase/server'

type SupabaseAny = ReturnType<typeof createSupabaseAdminClient> | Awaited<ReturnType<typeof createSupabaseServerClient>>

/**
 * Structural slice of `getCurrentWorkspace()` needed for quota checks, so this
 * module does not pull the full auth workspace helper into `lib/market`.
 */
export type ImportQuotaWorkspace = {
  access: {
    isPlatformAdmin: boolean
    accessSource: string
    limits: Partial<Record<string, number | null>>
  }
  organization?: { id: string } | null
}

export async function importPolicyForSource(supabase: SupabaseAny, organizationId: string, sourceType: string) {
  const { data } = await supabase
    .from('market_provider_policies')
    .select('*')
    .or(`organization_id.eq.${organizationId},organization_id.is.null`)
    .eq('source_type', sourceType)
    .order('organization_id', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  return providerPolicyFromRow(sourceType, data)
}

export async function countRecentProviderImports(supabase: SupabaseAny, organizationId: string, sourceType: string) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count } = await supabase
    .from('market_import_audit_events')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('event_type', 'listing_imported')
    .gte('created_at', since)
    .contains('metadata', { sourceType })
  return count || 0
}

export async function ensurePlanImportQuota(params: { supabase: SupabaseAny; workspace: ImportQuotaWorkspace; requested?: number }) {
  if (params.workspace.access.isPlatformAdmin) return
  const organizationId = params.workspace.organization?.id
  if (!organizationId) return

  const requested = Math.max(1, Number(params.requested || 1))
  const isPaidAccess = ['subscription', 'trial', 'user_override'].includes(params.workspace.access.accessSource)
  const limitKey = isPaidAccess ? 'max_imports_per_month' : 'max_imports_per_7_days'
  const limit = params.workspace.access.limits?.[limitKey]
  if (limit === null || limit === undefined) return

  const since = new Date(Date.now() - (isPaidAccess ? 30 : 7) * 24 * 60 * 60 * 1000).toISOString()
  const { count } = await params.supabase
    .from('market_import_audit_events')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('event_type', 'listing_imported')
    .gte('created_at', since)

  const used = count || 0
  if (used + requested > Number(limit)) {
    const period = isPaidAccess ? 'month' : '7 days'
    throw new Error(`Import limit reached: ${used}/${limit} used this ${period}. Upgrade or wait for the window to reset.`)
  }
}
