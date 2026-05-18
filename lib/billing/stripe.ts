import { createHmac, timingSafeEqual } from 'crypto'

export type StripeBillingInterval = 'month' | 'year'

export type StripePlanRow = {
  id: string
  code: string
  name: string
  description?: string | null
  currency?: string | null
  monthly_price_cents?: number | null
  annual_price_cents?: number | null
  is_active?: boolean | null
  is_public?: boolean | null
  stripe_product_id?: string | null
  stripe_monthly_price_id?: string | null
  stripe_annual_price_id?: string | null
}

export type StripeSyncResult = {
  stripe_product_id: string | null
  stripe_monthly_price_id: string | null
  stripe_annual_price_id: string | null
  stripe_sync_status: 'synced' | 'not_configured' | 'skipped_free' | 'failed'
  stripe_last_error: string | null
  stripe_synced_at: string | null
}

const STRIPE_API_BASE = 'https://api.stripe.com/v1'
const DEFAULT_APP_URL = 'http://localhost:3000'

function stripeSecretKey() {
  return process.env.STRIPE_SECRET_KEY || ''
}

export function hasStripeServerConfig() {
  return Boolean(stripeSecretKey())
}

export function stripeMode() {
  const key = stripeSecretKey()
  if (!key) return 'not_configured'
  if (key.startsWith('sk_live_')) return 'live'
  if (key.startsWith('sk_test_')) return 'test'
  return 'unknown'
}

export function appBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || DEFAULT_APP_URL
  const withProtocol = configured.startsWith('http') ? configured : `https://${configured}`
  return withProtocol.replace(/\/$/, '')
}

function toStripeForm(params: Record<string, string | number | boolean | null | undefined>) {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    body.append(key, String(value))
  }
  return body
}

async function stripeRequest<T>(path: string, params?: Record<string, string | number | boolean | null | undefined>, method: 'GET' | 'POST' = 'POST'): Promise<T> {
  const key = stripeSecretKey()
  if (!key) throw new Error('STRIPE_SECRET_KEY is missing. Add your Stripe test key in .env.local/Vercel first.')

  const url = method === 'GET' && params
    ? `${STRIPE_API_BASE}${path}?${toStripeForm(params).toString()}`
    : `${STRIPE_API_BASE}${path}`

  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      ...(method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: method === 'POST' ? toStripeForm(params || {}) : undefined,
    cache: 'no-store',
  })

  const json = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = json?.error?.message || `Stripe request failed with HTTP ${response.status}`
    throw new Error(message)
  }
  return json as T
}

function planMetadata(plan: StripePlanRow, interval?: StripeBillingInterval) {
  return {
    'metadata[dealflowiq_plan_id]': plan.id,
    'metadata[dealflowiq_plan_code]': plan.code,
    ...(interval ? { 'metadata[dealflowiq_interval]': interval } : {}),
  }
}

async function createOrUpdateProduct(plan: StripePlanRow) {
  const params = {
    name: plan.name,
    description: plan.description || undefined,
    active: plan.is_active !== false,
    ...planMetadata(plan),
  }

  if (plan.stripe_product_id) {
    return stripeRequest<{ id: string }>(`/products/${plan.stripe_product_id}`, params)
  }

  return stripeRequest<{ id: string }>('/products', params)
}

async function createRecurringPrice(params: {
  plan: StripePlanRow
  productId: string
  interval: StripeBillingInterval
  unitAmount: number
}) {
  return stripeRequest<{ id: string }>('/prices', {
    product: params.productId,
    currency: String(params.plan.currency || 'usd').toLowerCase(),
    unit_amount: Math.round(params.unitAmount),
    'recurring[interval]': params.interval,
    'nickname': `${params.plan.name} ${params.interval === 'month' ? 'Monthly' : 'Yearly'}`,
    ...planMetadata(params.plan, params.interval),
  })
}

export async function syncPlanWithStripe(plan: StripePlanRow, options?: { forceMonthlyPrice?: boolean; forceAnnualPrice?: boolean }): Promise<StripeSyncResult> {
  const monthly = Math.max(0, Number(plan.monthly_price_cents || 0))
  const annual = Math.max(0, Number(plan.annual_price_cents || 0))

  if (!hasStripeServerConfig()) {
    return {
      stripe_product_id: plan.stripe_product_id || null,
      stripe_monthly_price_id: plan.stripe_monthly_price_id || null,
      stripe_annual_price_id: plan.stripe_annual_price_id || null,
      stripe_sync_status: 'not_configured',
      stripe_last_error: 'STRIPE_SECRET_KEY is missing. Plan saved locally; Stripe sync will run when keys are configured.',
      stripe_synced_at: null,
    }
  }

  if (monthly <= 0 && annual <= 0) {
    return {
      stripe_product_id: plan.stripe_product_id || null,
      stripe_monthly_price_id: null,
      stripe_annual_price_id: null,
      stripe_sync_status: 'skipped_free',
      stripe_last_error: null,
      stripe_synced_at: new Date().toISOString(),
    }
  }

  try {
    const product = await createOrUpdateProduct(plan)
    let monthlyPriceId = options?.forceMonthlyPrice ? null : plan.stripe_monthly_price_id || null
    let annualPriceId = options?.forceAnnualPrice ? null : plan.stripe_annual_price_id || null

    if (monthly > 0 && !monthlyPriceId) {
      const price = await createRecurringPrice({ plan, productId: product.id, interval: 'month', unitAmount: monthly })
      monthlyPriceId = price.id
    }

    if (annual > 0 && !annualPriceId) {
      const price = await createRecurringPrice({ plan, productId: product.id, interval: 'year', unitAmount: annual })
      annualPriceId = price.id
    }

    return {
      stripe_product_id: product.id,
      stripe_monthly_price_id: monthly > 0 ? monthlyPriceId : null,
      stripe_annual_price_id: annual > 0 ? annualPriceId : null,
      stripe_sync_status: 'synced',
      stripe_last_error: null,
      stripe_synced_at: new Date().toISOString(),
    }
  } catch (error) {
    return {
      stripe_product_id: plan.stripe_product_id || null,
      stripe_monthly_price_id: plan.stripe_monthly_price_id || null,
      stripe_annual_price_id: plan.stripe_annual_price_id || null,
      stripe_sync_status: 'failed',
      stripe_last_error: error instanceof Error ? error.message : 'Stripe sync failed',
      stripe_synced_at: null,
    }
  }
}

export async function createStripeCheckoutSession(params: {
  organizationId: string
  userId: string
  userEmail?: string | null
  plan: StripePlanRow
  interval: StripeBillingInterval
  stripeCustomerId?: string | null
}) {
  const priceId = params.interval === 'year' ? params.plan.stripe_annual_price_id : params.plan.stripe_monthly_price_id
  if (!priceId) throw new Error(`Missing Stripe ${params.interval} price for ${params.plan.name}. Sync the plan with Stripe first.`)

  return stripeRequest<{ id: string; url: string }>('/checkout/sessions', {
    mode: 'subscription',
    success_url: `${appBaseUrl()}/settings/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appBaseUrl()}/settings/billing?checkout=cancelled`,
    client_reference_id: params.organizationId,
    ...(params.stripeCustomerId ? { customer: params.stripeCustomerId } : { customer_email: params.userEmail || undefined }),
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': 1,
    allow_promotion_codes: true,
    'metadata[organization_id]': params.organizationId,
    'metadata[user_id]': params.userId,
    'metadata[plan_id]': params.plan.id,
    'metadata[plan_code]': params.plan.code,
    'metadata[billing_interval]': params.interval,
    'subscription_data[metadata][organization_id]': params.organizationId,
    'subscription_data[metadata][user_id]': params.userId,
    'subscription_data[metadata][plan_id]': params.plan.id,
    'subscription_data[metadata][plan_code]': params.plan.code,
    'subscription_data[metadata][billing_interval]': params.interval,
  })
}

export async function createStripePortalSession(params: { stripeCustomerId: string; returnPath?: string }) {
  return stripeRequest<{ id: string; url: string }>('/billing_portal/sessions', {
    customer: params.stripeCustomerId,
    return_url: `${appBaseUrl()}${params.returnPath || '/settings/billing'}`,
  })
}

export async function retrieveStripeSubscription(subscriptionId: string) {
  return stripeRequest<Record<string, any>>(`/subscriptions/${subscriptionId}`, { 'expand[0]': 'items.data.price' }, 'GET')
}

export function verifyStripeWebhookSignature(payload: string, signatureHeader: string | null, secret?: string) {
  const endpointSecret = secret || process.env.STRIPE_WEBHOOK_SECRET || ''
  if (!endpointSecret) throw new Error('STRIPE_WEBHOOK_SECRET is missing.')
  if (!signatureHeader) throw new Error('Missing Stripe-Signature header.')

  const parts = signatureHeader.split(',').reduce<Record<string, string[]>>((acc, part) => {
    const [key, value] = part.split('=')
    if (!key || !value) return acc
    acc[key] = [...(acc[key] || []), value]
    return acc
  }, {})

  const timestamp = parts.t?.[0]
  const signatures = parts.v1 || []
  if (!timestamp || !signatures.length) throw new Error('Invalid Stripe signature header.')

  const signedPayload = `${timestamp}.${payload}`
  const expected = createHmac('sha256', endpointSecret).update(signedPayload, 'utf8').digest('hex')
  const expectedBuffer = Buffer.from(expected, 'hex')

  const match = signatures.some((signature) => {
    const signatureBuffer = Buffer.from(signature, 'hex')
    return signatureBuffer.length === expectedBuffer.length && timingSafeEqual(signatureBuffer, expectedBuffer)
  })

  if (!match) throw new Error('Stripe webhook signature verification failed.')

  const age = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (Number.isFinite(age) && age > 300) throw new Error('Stripe webhook timestamp is outside the allowed tolerance.')
  return true
}
