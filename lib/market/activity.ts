type SupabaseLike = {
  from: (table: string) => any
}

type ActivityInput = {
  organizationId: string
  listingId: string
  actorId?: string | null
  eventType: string
  title: string
  description?: string | null
  metadata?: Record<string, any>
}

export async function recordMarketListingActivity(supabase: SupabaseLike, input: ActivityInput) {
  try {
    await supabase.from('market_listing_activity_events').insert({
      organization_id: input.organizationId,
      listing_id: input.listingId,
      actor_id: input.actorId || null,
      event_type: input.eventType,
      title: input.title,
      description: input.description || null,
      metadata: input.metadata || {},
    })
  } catch {
    // Activity should never block a production deal workflow.
  }
}
