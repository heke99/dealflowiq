'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentWorkspace } from '@/lib/auth/workspace'

export async function markNotificationReadAction(formData: FormData) {
  const id = String(formData.get('notification_id') || '').trim()
  const returnTo = String(formData.get('return_to') || '/notifications')
  if (!id) redirect(returnTo)
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  const supabase = await createSupabaseServerClient()
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', workspace.organization.id)
    .or(`user_id.is.null,user_id.eq.${workspace.user.id}`)
  revalidatePath('/notifications')
  revalidatePath('/dashboard')
  redirect(returnTo.startsWith('/') ? returnTo : '/notifications')
}

export async function markAllNotificationsReadAction() {
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  const supabase = await createSupabaseServerClient()
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('organization_id', workspace.organization.id)
    .is('read_at', null)
    .or(`user_id.is.null,user_id.eq.${workspace.user.id}`)
  revalidatePath('/notifications')
  revalidatePath('/dashboard')
  redirect('/notifications?saved=read')
}
