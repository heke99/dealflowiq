'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { hasOrganizationRole, MANAGEMENT_ROLES } from '@/lib/auth/access'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ACCOUNT_TYPES, type AccountType } from '@/lib/product/accountTypes'
import { recordAuditEvent } from '@/lib/audit'

const STRATEGIES = new Set(['buy_and_hold', 'section8', 'brrrr', 'fix_and_flip', 'wholesale', 'seller_finance', 'mixed'])

function accountTypeValue(value: FormDataEntryValue | null): AccountType | null {
  const stringValue = String(value || '')
  return ACCOUNT_TYPES.includes(stringValue as AccountType) ? (stringValue as AccountType) : null
}

async function markOnboardingComplete(userId: string) {
  const supabase = await createSupabaseServerClient()
  await supabase.from('profiles').update({ onboarding_completed: true }).eq('id', userId)
}

export async function completeOnboardingAction(formData: FormData) {
  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()

  const accountType = accountTypeValue(formData.get('account_type'))
  const workspaceName = String(formData.get('workspace_name') || '').trim()
  const primaryMarket = String(formData.get('primary_market') || '').trim().slice(0, 120)
  const strategyRaw = String(formData.get('primary_strategy') || '').trim()
  const primaryStrategy = STRATEGIES.has(strategyRaw) ? strategyRaw : null

  if (accountType) {
    await supabase.from('profiles').update({ account_type: accountType }).eq('id', workspace.user.id)
  }

  if (workspace.organization?.id && hasOrganizationRole(workspace, MANAGEMENT_ROLES)) {
    const orgUpdate: Record<string, unknown> = {}
    if (workspaceName && workspaceName.length >= 2) orgUpdate.name = workspaceName
    if (primaryMarket) orgUpdate.primary_market = primaryMarket
    if (primaryStrategy) orgUpdate.primary_strategy = primaryStrategy
    if (accountType) orgUpdate.account_type = accountType
    if (Object.keys(orgUpdate).length) {
      const { error } = await supabase.from('organizations').update(orgUpdate).eq('id', workspace.organization.id)
      if (error) redirect(`/onboarding?error=${encodeURIComponent(error.message)}`)
    }
  }

  await markOnboardingComplete(workspace.user.id)
  await recordAuditEvent({
    organizationId: workspace.organization?.id || null,
    actorId: workspace.user.id,
    eventType: 'onboarding.completed',
    entityType: 'profile',
    entityId: workspace.user.id,
    metadata: { account_type: accountType, primary_market: primaryMarket || null, primary_strategy: primaryStrategy },
  })

  revalidatePath('/dashboard')
  const next = String(formData.get('next') || '')
  if (next === 'buy-box') redirect('/buy-boxes?from=onboarding')
  if (next === 'import') redirect('/imports?from=onboarding')
  if (next === 'invite') redirect('/community?from=onboarding')
  redirect('/dashboard?onboarded=1')
}

export async function skipOnboardingAction() {
  const workspace = await getCurrentWorkspace()
  await markOnboardingComplete(workspace.user.id)
  revalidatePath('/dashboard')
  redirect('/dashboard')
}

/**
 * Recovery: re-runs the workspace bootstrap RPC for users whose signup
 * completed but whose organization/membership creation failed.
 */
export async function retryWorkspaceSetupAction(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('create_default_organization')
  const returnTo = String(formData.get('return_to') || '/dashboard')
  const safeReturn = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/dashboard'
  if (error) redirect(`${safeReturn}?error=${encodeURIComponent(`Workspace setup failed again: ${error.message}. Contact support if this persists.`)}`)
  revalidatePath('/dashboard')
  redirect(`${safeReturn}?message=${encodeURIComponent('Workspace setup completed.')}`)
}

/**
 * Recovery: re-runs subscription bootstrap for organizations that exist but
 * have no subscription row (e.g. the RPC failed mid-signup).
 */
export async function retrySubscriptionSetupAction(formData: FormData) {
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=No workspace found. Retry workspace setup first.')
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('ensure_organization_subscription', {
    _organization_id: workspace.organization.id,
    _account_type: workspace.access.accountType,
  })
  const returnTo = String(formData.get('return_to') || '/settings/billing')
  const safeReturn = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/settings/billing'
  if (error) redirect(`${safeReturn}?error=${encodeURIComponent(`Subscription setup failed: ${error.message}. Contact support if this persists.`)}`)
  revalidatePath('/settings/billing')
  revalidatePath('/dashboard')
  redirect(`${safeReturn}?message=${encodeURIComponent('Subscription restored.')}`)
}
