'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createStripeCheckoutSession, createStripePortalSession, syncPlanWithStripe, type StripeBillingInterval } from '@/lib/billing/stripe'

function intervalValue(value: FormDataEntryValue | null): StripeBillingInterval {
  return String(value || 'month') === 'year' ? 'year' : 'month'
}

export async function startCheckoutAction(formData: FormData) {
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')

  const planId = String(formData.get('plan_id') || '').trim()
  const interval = intervalValue(formData.get('interval'))
  if (!planId) redirect('/settings/billing?error=Choose a plan first')

  const supabase = await createSupabaseServerClient()
  const [{ data: plan, error: planError }, { data: subscription }] = await Promise.all([
    supabase
      .from('billing_plans')
      .select('*')
      .eq('id', planId)
      .eq('is_active', true)
      .maybeSingle(),
    supabase
      .from('organization_subscriptions')
      .select('stripe_customer_id')
      .eq('organization_id', workspace.organization.id)
      .maybeSingle(),
  ])

  if (planError || !plan) redirect(`/settings/billing?error=${encodeURIComponent(planError?.message || 'Plan not found')}`)

  const priceCents = interval === 'year' ? Number((plan as any).annual_price_cents || 0) : Number((plan as any).monthly_price_cents || 0)
  if (priceCents <= 0) {
    const { error } = await supabase.from('organization_subscriptions').upsert({
      organization_id: workspace.organization.id,
      plan_id: planId,
      status: 'active',
      trial_start_at: null,
      trial_end_at: null,
      current_period_start: new Date().toISOString(),
      current_period_end: null,
      trial_source: 'plan_default',
      notes: 'Free plan selected by workspace owner.',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'organization_id' })
    if (error) redirect(`/settings/billing?error=${encodeURIComponent(error.message)}`)
    revalidatePath('/settings/billing')
    redirect('/settings/billing?checkout=free')
  }

  let stripeReadyPlan = plan as any
  const missingPrice = interval === 'year' ? !stripeReadyPlan.stripe_annual_price_id : !stripeReadyPlan.stripe_monthly_price_id
  if (missingPrice) {
    const sync = await syncPlanWithStripe(stripeReadyPlan)
    const { data: updatedPlan, error: updateError } = await supabase
      .from('billing_plans')
      .update(sync)
      .eq('id', planId)
      .select('*')
      .single()
    if (updateError) redirect(`/settings/billing?error=${encodeURIComponent(updateError.message)}`)
    stripeReadyPlan = updatedPlan as any
  }

  const session = await createStripeCheckoutSession({
    organizationId: workspace.organization.id,
    userId: workspace.user.id,
    userEmail: workspace.user.email,
    plan: stripeReadyPlan,
    interval,
    stripeCustomerId: (subscription as any)?.stripe_customer_id || null,
  }).catch((error) => {
    redirect(`/settings/billing?error=${encodeURIComponent(error instanceof Error ? error.message : 'Could not create Stripe Checkout session')}`)
  })

  if (!session?.url) redirect('/settings/billing?error=Stripe Checkout did not return a redirect URL')
  redirect(session.url)
}

export async function openBillingPortalAction() {
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  const supabase = await createSupabaseServerClient()
  const { data: subscription, error } = await supabase
    .from('organization_subscriptions')
    .select('stripe_customer_id')
    .eq('organization_id', workspace.organization.id)
    .maybeSingle()

  if (error) redirect(`/settings/billing?error=${encodeURIComponent(error.message)}`)
  const customerId = (subscription as any)?.stripe_customer_id
  if (!customerId) redirect('/settings/billing?error=No Stripe customer is connected to this workspace yet')

  const session = await createStripePortalSession({ stripeCustomerId: customerId }).catch((portalError) => {
    redirect(`/settings/billing?error=${encodeURIComponent(portalError instanceof Error ? portalError.message : 'Could not open Stripe customer portal')}`)
  })

  if (!session?.url) redirect('/settings/billing?error=Stripe Customer Portal did not return a redirect URL')
  redirect(session.url)
}
