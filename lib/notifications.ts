type SupabaseLike = {
  from: (table: string) => any
}

export type NotificationInput = {
  organizationId: string
  userId?: string | null
  actorId?: string | null
  type: string
  title: string
  message: string
  relatedEntityType?: string | null
  relatedEntityId?: string | null
  actionHref?: string | null
  metadata?: Record<string, any>
}

export async function createInAppNotification(supabase: SupabaseLike, input: NotificationInput) {
  try {
    await supabase.from('notifications').insert({
      organization_id: input.organizationId,
      user_id: input.userId || null,
      actor_id: input.actorId || null,
      type: input.type,
      title: input.title,
      message: input.message,
      related_entity_type: input.relatedEntityType || null,
      related_entity_id: input.relatedEntityId || null,
      action_href: input.actionHref || null,
      metadata: input.metadata || {},
    })
  } catch {
    // Notifications are helpful UX, but they must not block imports, matching or scoring.
  }
}
