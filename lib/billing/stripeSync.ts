import type { createSupabaseAdminClient } from '@/lib/supabase/admin'

type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>

type SubscriptionLike = Record<string, any>

function unixToIso(value: unknown) {
  const numberValue = Number(value || 0)
  if (!Number.isFinite(numberValue) || numberValue <= 0) return null
  return new Date(numberValue * 1000).toISOString()
}

function normalizeStripeStatus(status: string) {
  if (status === 'active') return 'active'
  if (status === 'trialing') return 'trialing'
  if (status === 'past_due') return 'past_due'
  if (status === 'unpaid') return 'unpaid'
  if (status === 'incomplete') return 'incomplete'
  if (status === 'incomplete_expired') return 'expired'
  if (status === 'canceled') return 'canceled'
  if (status === 'paused') return 'past_due'
  return 'past_due'
}

function firstSubscriptionItem(subscription: SubscriptionLike) {
  return Array.isArray(subscription?.items?.data) ? subscription.items.data[0] : null
}

function stringOrNull(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export async function syncStripeSubscriptionToDatabase(params: {
  supabase: SupabaseAdmin
  subscription: SubscriptionLike
  sourceEventId?: string | null
}) {
  const subscription = params.subscription
  const item = firstSubscriptionItem(subscription)
  const price = item?.price || null
  const stripePriceId = stringOrNull(price?.id)
  const stripeCustomerId = typeof subscription.customer === 'string' ? subscription.customer : stringOrNull(subscription.customer?.id)
  const metadata = subscription.metadata && typeof subscription.metadata === 'object' ? subscription.metadata : {}

  let organizationId = stringOrNull(metadata.organization_id)
  let planId = stringOrNull(metadata.plan_id)

  if (!planId && stripePriceId) {
    const { data: planByPrice } = await params.supabase
      .from('billing_plans')
      .select('id')
      .or(`stripe_monthly_price_id.eq.${stripePriceId},stripe_annual_price_id.eq.${stripePriceId}`)
      .maybeSingle()
    planId = stringOrNull((planByPrice as any)?.id)
  }

  if (!organizationId && stringOrNull(subscription.id)) {
    const { data: bySubscription } = await params.supabase
      .from('organization_subscriptions')
      .select('organization_id')
      .eq('stripe_subscription_id', subscription.id)
      .maybeSingle()
    organizationId = stringOrNull((bySubscription as any)?.organization_id)
  }

  if (!organizationId && stripeCustomerId) {
    const { data: byCustomer } = await params.supabase
      .from('organization_subscriptions')
      .select('organization_id')
      .eq('stripe_customer_id', stripeCustomerId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    organizationId = stringOrNull((byCustomer as any)?.organization_id)
  }

  if (!organizationId) {
    return { synced: false, reason: 'missing_organization_id' }
  }

  const status = normalizeStripeStatus(String(subscription.status || 'past_due'))
  const now = new Date().toISOString()
  const periodStart = unixToIso(subscription.current_period_start)
  const periodEnd = unixToIso(subscription.current_period_end)
  const trialStart = unixToIso(subscription.trial_start)
  const trialEnd = unixToIso(subscription.trial_end)

  const payload: Record<string, any> = {
    organization_id: organizationId,
    plan_id: planId,
    status,
    trial_start_at: status === 'trialing' ? trialStart : null,
    trial_end_at: status === 'trialing' ? trialEnd : null,
    current_period_start: periodStart,
    current_period_end: periodEnd,
    trial_source: status === 'trialing' ? 'plan_default' : 'plan_default',
    stripe_customer_id: stripeCustomerId,
    stripe_subscription_id: stringOrNull(subscription.id),
    stripe_subscription_item_id: stringOrNull(item?.id),
    stripe_price_id: stripePriceId,
    stripe_interval: stringOrNull(price?.recurring?.interval),
    stripe_status_raw: String(subscription.status || ''),
    stripe_cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    stripe_canceled_at: unixToIso(subscription.canceled_at),
    stripe_current_period_start: periodStart,
    stripe_current_period_end: periodEnd,
    notes: `Synced from Stripe${params.sourceEventId ? ` event ${params.sourceEventId}` : ''}.`,
    updated_at: now,
  }

  const { error } = await params.supabase
    .from('organization_subscriptions')
    .upsert(payload, { onConflict: 'organization_id' })

  if (error) throw new Error(error.message)

  return { synced: true, organizationId, planId, status }
}

export async function syncCheckoutSessionToDatabase(params: {
  supabase: SupabaseAdmin
  session: Record<string, any>
  subscription: SubscriptionLike
  sourceEventId?: string | null
}) {
  const sessionMetadata = params.session.metadata && typeof params.session.metadata === 'object' ? params.session.metadata : {}
  params.subscription.metadata = {
    ...(params.subscription.metadata || {}),
    organization_id: params.subscription.metadata?.organization_id || sessionMetadata.organization_id,
    user_id: params.subscription.metadata?.user_id || sessionMetadata.user_id,
    plan_id: params.subscription.metadata?.plan_id || sessionMetadata.plan_id,
    plan_code: params.subscription.metadata?.plan_code || sessionMetadata.plan_code,
    billing_interval: params.subscription.metadata?.billing_interval || sessionMetadata.billing_interval,
  }
  return syncStripeSubscriptionToDatabase({ supabase: params.supabase, subscription: params.subscription, sourceEventId: params.sourceEventId })
}
