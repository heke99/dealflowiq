import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export type AuditEventInput = {
  organizationId?: string | null
  actorId?: string | null
  eventType: string
  entityType?: string | null
  entityId?: string | null
  metadata?: Record<string, unknown>
}

/**
 * Records an audit event through the service-role client so platform-admin
 * actions on organizations the admin is not a member of are still captured
 * (the RLS insert policy requires org membership for user-context writes).
 * Auditing must never break the action it documents, so failures are
 * swallowed after a console warning.
 */
export async function recordAuditEvent(input: AuditEventInput) {
  try {
    const supabase = createSupabaseAdminClient()
    const { error } = await supabase.from('audit_logs').insert({
      organization_id: input.organizationId || null,
      actor_id: input.actorId || null,
      event_type: input.eventType,
      entity_type: input.entityType || null,
      entity_id: input.entityId || null,
      metadata: input.metadata || {},
    })
    if (error) console.warn(`[audit] failed to record ${input.eventType}: ${error.message}`)
  } catch (error) {
    console.warn(`[audit] failed to record ${input.eventType}:`, error instanceof Error ? error.message : error)
  }
}
