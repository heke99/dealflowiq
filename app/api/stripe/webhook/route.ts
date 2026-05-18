import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { retrieveStripeSubscription, verifyStripeWebhookSignature } from '@/lib/billing/stripe'
import { syncCheckoutSessionToDatabase, syncStripeSubscriptionToDatabase } from '@/lib/billing/stripeSync'

export const runtime = 'nodejs'

type StripeEvent = {
  id: string
  type: string
  created?: number
  data?: { object?: Record<string, any> }
}

async function markEvent(params: { id: string; type: string; status: string; payload: Record<string, any>; error?: string | null }) {
  const supabase = createSupabaseAdminClient()
  await supabase.from('stripe_webhook_events').upsert({
    stripe_event_id: params.id,
    event_type: params.type,
    status: params.status,
    payload: params.payload,
    error_message: params.error || null,
    processed_at: params.status === 'processed' ? new Date().toISOString() : null,
  }, { onConflict: 'stripe_event_id' })
}

export async function POST(request: Request) {
  const payload = await request.text()
  const signature = request.headers.get('stripe-signature')

  try {
    verifyStripeWebhookSignature(payload, signature)
  } catch (error) {
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
  const { data: existing } = await supabase
    .from('stripe_webhook_events')
    .select('id,status')
    .eq('stripe_event_id', event.id)
    .maybeSingle()

  if ((existing as any)?.status === 'processed') {
    return NextResponse.json({ received: true, duplicate: true })
  }

  await markEvent({ id: event.id, type: event.type, status: 'processing', payload: event as any })

  try {
    const object = event.data?.object || {}

    if (event.type === 'checkout.session.completed') {
      const subscriptionId = typeof object.subscription === 'string' ? object.subscription : object.subscription?.id
      if (subscriptionId) {
        const subscription = await retrieveStripeSubscription(subscriptionId)
        await syncCheckoutSessionToDatabase({ supabase, session: object, subscription, sourceEventId: event.id })
      }
    }

    if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      await syncStripeSubscriptionToDatabase({ supabase, subscription: object, sourceEventId: event.id })
    }

    if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
      const subscriptionId = typeof object.subscription === 'string' ? object.subscription : object.subscription?.id
      if (subscriptionId) {
        const subscription = await retrieveStripeSubscription(subscriptionId)
        await syncStripeSubscriptionToDatabase({ supabase, subscription, sourceEventId: event.id })
      }
    }

    await markEvent({ id: event.id, type: event.type, status: 'processed', payload: event as any })
    return NextResponse.json({ received: true })
  } catch (error) {
    await markEvent({ id: event.id, type: event.type, status: 'failed', payload: event as any, error: error instanceof Error ? error.message : 'Stripe webhook processing failed' })
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Stripe webhook processing failed' }, { status: 500 })
  }
}
