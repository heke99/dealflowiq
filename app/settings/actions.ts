'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { ACCOUNT_TYPES, type AccountType } from '@/lib/product/accountTypes'
import { safeRedirectPath } from '@/lib/auth/redirects'
import { passwordIsStrong } from '@/lib/auth/password'
import { recordPasswordChangeOrThrow } from '@/lib/auth/password-events'

const STRATEGIES = new Set(['buy_and_hold','section8','brrrr','fix_and_flip','wholesale','seller_finance','mixed'])

export async function switchWorkspaceAction(formData: FormData) {
  const organizationId = String(formData.get('organization_id') || '').trim()
  const returnTo = safeRedirectPath(formData.get('return_to'), '/dashboard')
  if (!organizationId) redirect(`${returnTo}?error=WORKSPACE_ACCESS_DENIED`)
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('set_active_organization', { _organization_id: organizationId })
  if (error) redirect(`${returnTo}?error=WORKSPACE_ACCESS_DENIED`)
  revalidatePath('/', 'layout')
  redirect(returnTo)
}

export async function updateWorkspaceSettingsAction(formData: FormData) {
  const accountType = String(formData.get('account_type') || '') as AccountType
  const strategy = String(formData.get('primary_strategy') || '').trim()
  if (!ACCOUNT_TYPES.includes(accountType)) redirect('/settings?error=SETTINGS_INVALID')
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('update_user_workspace_settings', {
    _full_name: String(formData.get('full_name') || '').trim(),
    _account_type: accountType,
    _workspace_name: String(formData.get('workspace_name') || '').trim(),
    _primary_market: String(formData.get('primary_market') || '').trim(),
    _primary_strategy: STRATEGIES.has(strategy) ? strategy : null,
  })
  if (error) redirect('/settings?error=SETTINGS_INVALID')
  revalidatePath('/', 'layout')
  redirect('/settings?message=SETTINGS_SAVED')
}


export async function changePasswordAction(formData: FormData) {
  const currentPassword = String(formData.get('current_password') || '')
  const newPassword = String(formData.get('new_password') || '')
  const confirmPassword = String(formData.get('confirm_password') || '')
  if (!passwordIsStrong(newPassword) || newPassword !== confirmPassword) redirect('/settings?error=PASSWORD_INVALID')

  const supabase = await createSupabaseServerClient()
  const { data: userData } = await supabase.auth.getUser()
  const email = userData.user?.email
  if (!email) redirect('/settings?error=AUTH_REQUIRED')

  const { error: reauthError } = await supabase.auth.signInWithPassword({ email, password: currentPassword })
  if (reauthError) redirect('/settings?error=REAUTH_REQUIRED')
  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
  if (updateError) redirect('/settings?error=PASSWORD_CHANGE_FAILED')
  try {
    await recordPasswordChangeOrThrow()
  } catch (error) {
    console.error('[password-change] event/outbox write failed', error)
    await supabase.auth.signOut({ scope: 'others' })
    redirect('/settings?error=PASSWORD_CHANGE_AUDIT_FAILED')
  }
  await supabase.auth.signOut({ scope: 'others' })
  redirect('/settings?message=PASSWORD_CHANGED')
}

export async function transferOwnershipAction(formData: FormData) {
  const organizationId = String(formData.get('organization_id') || '').trim()
  const newOwnerUserId = String(formData.get('new_owner_user_id') || '').trim()
  const currentPassword = String(formData.get('current_password') || '')
  if (!organizationId || !newOwnerUserId) redirect('/settings?error=OWNERSHIP_TRANSFER_INVALID')

  const supabase = await createSupabaseServerClient()
  const { data: userData } = await supabase.auth.getUser()
  const email = userData.user?.email
  if (!email) redirect('/settings?error=AUTH_REQUIRED')
  const { error: reauthError } = await supabase.auth.signInWithPassword({ email, password: currentPassword })
  if (reauthError) redirect('/settings?error=REAUTH_REQUIRED')
  const { error } = await supabase.rpc('transfer_organization_ownership', {
    _organization_id: organizationId,
    _new_owner_user_id: newOwnerUserId,
  })
  if (error) redirect('/settings?error=OWNERSHIP_TRANSFER_FAILED')
  revalidatePath('/', 'layout')
  redirect('/settings?message=OWNERSHIP_TRANSFERRED')
}


export async function deleteAccountAction(formData: FormData) {
  const currentPassword = String(formData.get('current_password') || '')
  const confirmation = String(formData.get('confirmation') || '').trim().toUpperCase()
  if (confirmation !== 'DELETE') redirect('/settings?error=ACCOUNT_DELETION_CONFIRMATION_REQUIRED')

  const supabase = await createSupabaseServerClient()
  const { data: userData } = await supabase.auth.getUser()
  const user = userData.user
  if (!user?.id || !user.email) redirect('/settings?error=AUTH_REQUIRED')

  const { error: reauthError } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword })
  if (reauthError) redirect('/settings?error=REAUTH_REQUIRED')

  const { data: requestId, error: prepareError } = await supabase.rpc('prepare_account_deletion')
  if (prepareError) {
    const code = String(prepareError.message || '').includes('ACCOUNT_DELETION_BLOCKED_OWNER')
      ? 'ACCOUNT_DELETION_BLOCKED_OWNER'
      : 'ACCOUNT_DELETION_FAILED'
    redirect(`/settings?error=${code}`)
  }

  const admin = createSupabaseAdminClient()
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
  if (deleteError) {
    await admin.rpc('finalize_account_deletion', {
      _request_id: requestId,
      _success: false,
      _error_code: 'AUTH_DELETE_FAILED',
    })
    redirect('/settings?error=ACCOUNT_DELETION_FAILED')
  }

  let finalizeError = (await admin.rpc('finalize_account_deletion', {
    _request_id: requestId,
    _success: true,
    _error_code: null,
  })).error
  if (finalizeError) {
    finalizeError = (await admin.rpc('finalize_account_deletion', {
      _request_id: requestId,
      _success: true,
      _error_code: null,
    })).error
  }
  if (finalizeError) console.error('[account-deletion] finalization pending', { requestId, error: finalizeError.message })

  await supabase.auth.signOut()
  redirect('/?message=ACCOUNT_DELETED')
}
