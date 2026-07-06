import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { retrieveStripeSubscription, verifyStripeWebhookSignature } from '@/lib/billing/stripe'
import { syncCheckoutSessionToDatabase, syncStripeSubscriptionToDatabase } from '@/lib/billing/stripeSync'
import { decideWebhookRetry } from '@/lib/billing/webhookIdempotency'
import { logWarn } from '@/lib/observability/log'
import { asRow, rowString } from '@/lib/types/rows'

export const runtime = 'nodejs'

type StripeEvent = {
  id: string
  type: string
  created?: number
  data?: { object?: Record<string, unknown> }
}

async function markEvent(params: { id: string; type: string; status: string; payload: Record<string, unknown>; error?: string | null }) {
  const supabase = createSupabaseAdminClient()
  await supabase.from('stripe_webhook_events').upsert({
    stripe_event_id: params.id,
    event_type: params.type,
    status: params.status,
    payload: params.payload,
    error_message: params.error || null,
    processed_at: params.status === 'processed' ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'stripe_event_id' })
}

export async function POST(request: Request) {
  const payload = await request.text()
  const signature = request.headers.get('stripe-signature')

  try {
    verifyStripeWebhookSignature(payload, signature)
  } catch (error) {
    // Signature failures never reach the events table (no trusted event id),
    // so log them for operators watching for misconfiguration or abuse.
    logWarn('stripe.webhook.signature_failed', { detail: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid Stripe signature' }, { status: 400 })
  }

  let event: StripeEvent
  try {
    event = JSON.parse(payload) as StripeEvent
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  if (!event?.id || !event?.type) {
    return NextResponse.json({ error: 'Invalid Stripe event shape' }, { status: 400 })
  }

  const supabase = createSupabaseAdminClient()

  // Insert-first idempotency: the unique constraint on stripe_event_id is the
  // arbiter, so two concurrent deliveries cannot both claim the event.
  const { error: claimError } = await supabase.from('stripe_webhook_events').insert({
    stripe_event_id: event.id,
    event_type: event.type,
    status: 'processing',
    payload: event,
  })

  if (claimError) {
    const isDuplicate = claimError.code === '23505'
    if (!isDuplicate) {
      logWarn('stripe.webhook.claim_failed', { detail: claimError.message, eventId: event.id })
      return NextResponse.json({ error: 'Could not record webhook event' }, { status: 500 })
    }
    const { data: existing } = await supabase
      .from('stripe_webhook_events')
      .select('id,status,updated_at')
      .eq('stripe_event_id', event.id)
      .maybeSingle()
    const existingRow = asRow(existing)
    const decision = decideWebhookRetry({
      existingStatus: rowString(existingRow?.status),
      updatedAt: rowString(existingRow?.updated_at),
    })
    if (decision === 'skip_duplicate') {
      return NextResponse.json({ received: true, duplicate: true })
    }
    if (decision === 'skip_in_progress') {
      return NextResponse.json({ received: true, inProgress: true })
    }
    // Failed or stale: take the event over and process it again.
    await markEvent({ id: event.id, type: event.type, status: 'processing', payload: event })
  }

  try {
    const object = event.data?.object || {}

    if (event.type === 'checkout.session.completed') {
      const subscriptionId = typeof object.subscription === 'string' ? object.subscription : rowString(asRow(object.subscription)?.id)
      if (subscriptionId) {
        const subscription = await retrieveStripeSubscription(subscriptionId)
        await syncCheckoutSessionToDatabase({ supabase, session: object, subscription, sourceEventId: event.id })
      }
    }

    if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      await syncStripeSubscriptionToDatabase({ supabase, subscription: object, sourceEventId: event.id })
    }

    if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
      const subscriptionId = typeof object.subscription === 'string' ? object.subscription : rowString(asRow(object.subscription)?.id)
      if (subscriptionId) {
        const subscription = await retrieveStripeSubscription(subscriptionId)
        await syncStripeSubscriptionToDatabase({ supabase, subscription, sourceEventId: event.id })
      }
    }

    await markEvent({ id: event.id, type: event.type, status: 'processed', payload: event })
    return NextResponse.json({ received: true })
  } catch (error) {
    await markEvent({ id: event.id, type: event.type, status: 'failed', payload: event, error: error instanceof Error ? error.message : 'Stripe webhook processing failed' })
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Stripe webhook processing failed' }, { status: 500 })
  }
}
