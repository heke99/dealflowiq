import type { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { createSupabaseServerClient } from '@/lib/supabase/server'

type SupabaseLike = Awaited<ReturnType<typeof createSupabaseServerClient>> | ReturnType<typeof createSupabaseAdminClient>

export async function recordImportAuditEvent(supabase: SupabaseLike, params: {
  organizationId: string
  userId?: string | null
  importBatchId?: string | null
  listingId?: string | null
  eventType: string
  message: string
  metadata?: Record<string, any>
}) {
  await supabase.from('market_import_audit_events').insert({
    organization_id: params.organizationId,
    user_id: params.userId || null,
    import_batch_id: params.importBatchId || null,
    listing_id: params.listingId || null,
    event_type: params.eventType,
    message: params.message,
    metadata: params.metadata || {},
  })
}
