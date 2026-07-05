/**
 * Pure decision logic for Stripe webhook idempotency.
 *
 * Events are recorded insert-first against the unique `stripe_event_id`
 * column, so concurrent deliveries race on the database constraint instead
 * of a read-then-write window. When the insert conflicts, this helper
 * decides what to do with the existing row.
 */

/** How long a 'processing' row may sit before another delivery takes over. */
export const STALE_PROCESSING_MS = 5 * 60 * 1000

export type WebhookEventDecision =
  | 'skip_duplicate' // already processed successfully — acknowledge and stop
  | 'skip_in_progress' // another worker is actively processing — acknowledge and stop
  | 'reprocess' // failed or stale processing — take over and process again

export function decideWebhookRetry(params: {
  existingStatus: string | null | undefined
  updatedAt: string | null | undefined
  now?: number
}): WebhookEventDecision {
  const now = params.now ?? Date.now()
  const status = params.existingStatus || ''

  if (status === 'processed') return 'skip_duplicate'

  if (status === 'processing') {
    const updatedMs = params.updatedAt ? new Date(params.updatedAt).getTime() : 0
    const isStale = !Number.isFinite(updatedMs) || updatedMs <= 0 || now - updatedMs > STALE_PROCESSING_MS
    return isStale ? 'reprocess' : 'skip_in_progress'
  }

  // 'failed' or anything unexpected: safe to retry because processing is
  // idempotent (subscription state is upserted from Stripe's source of truth).
  return 'reprocess'
}
