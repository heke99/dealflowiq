'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ACCOUNT_TYPES, type AccountType } from '@/lib/product/accountTypes'
import { safeRedirectPath } from '@/lib/auth/redirects'

const STRATEGIES = new Set(['buy_and_hold','section8','brrrr','fix_and_flip','wholesale','seller_finance','mixed'])

function accountTypeValue(value: FormDataEntryValue | null): AccountType | null {
  const stringValue = String(value || '')
  return ACCOUNT_TYPES.includes(stringValue as AccountType) ? stringValue as AccountType : null
}

export async function completeOnboardingAction(formData: FormData) {
  const workspace = await getCurrentWorkspace()
  const accountType = accountTypeValue(formData.get('account_type'))
  const primaryStrategyRaw = String(formData.get('primary_strategy') || '').trim()
  if (!accountType) redirect('/onboarding?error=ONBOARDING_FAILED')

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('complete_user_onboarding', {
    _full_name: String(formData.get('full_name') || workspace.profile?.full_name || '').trim(),
    _account_type: accountType,
    _workspace_name: String(formData.get('workspace_name') || '').trim(),
    _primary_market: String(formData.get('primary_market') || '').trim(),
    _primary_strategy: STRATEGIES.has(primaryStrategyRaw) ? primaryStrategyRaw : null,
    _onboarding_version: 1,
  })
  if (error) redirect('/onboarding?error=ONBOARDING_FAILED')

  revalidatePath('/', 'layout')
  const next = String(formData.get('next') || '')
  if (next === 'buy-box') redirect('/buy-boxes?from=onboarding')
  if (next === 'import') redirect('/imports?from=onboarding')
  if (next === 'invite') redirect('/community?from=onboarding')
  redirect('/dashboard?onboarded=1')
}

export async function skipOnboardingAction() {
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('skip_user_onboarding', { _onboarding_version: 1 })
  if (error) redirect('/onboarding?error=ONBOARDING_FAILED')
  revalidatePath('/', 'layout')
  redirect('/dashboard')
}

export async function retryWorkspaceSetupAction(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('bootstrap_current_user', { _invite_code: null })
  const returnTo = safeRedirectPath(formData.get('return_to'), '/onboarding')
  if (error) redirect(`${returnTo}?error=WORKSPACE_BOOTSTRAP_FAILED`)
  revalidatePath('/', 'layout')
  redirect(`${returnTo}?message=WORKSPACE_READY`)
}

export async function retrySubscriptionSetupAction(formData: FormData) {
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/onboarding?error=WORKSPACE_BOOTSTRAP_FAILED')
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('restore_organization_subscription', { _organization_id: workspace.organization.id })
  const returnTo = safeRedirectPath(formData.get('return_to'), '/settings/billing')
  if (error) redirect(`${returnTo}?error=WORKSPACE_ACCESS_DENIED`)
  revalidatePath('/', 'layout')
  redirect(`${returnTo}?message=SUBSCRIPTION_RESTORED`)
}
