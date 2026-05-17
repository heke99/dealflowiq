'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentWorkspace } from '@/lib/auth/workspace'

function safeReturn(value: FormDataEntryValue | null, fallback = '/notifications') {
  const text = String(value || fallback)
  return text.startsWith('/') ? text : fallback
}

async function scopedNotificationQuery() {
  const workspace = await getCurrentWorkspace()
  if (!workspace.organization?.id) redirect('/dashboard?error=Missing organization')
  const supabase = await createSupabaseServerClient()
  return { workspace, supabase }
}

export async function markNotificationReadAction(formData: FormData) {
  const id = String(formData.get('notification_id') || '').trim()
  const returnTo = safeReturn(formData.get('return_to'))
  if (!id) redirect(returnTo)
  const { workspace, supabase } = await scopedNotificationQuery()
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', workspace.organization!.id)
    .or(`user_id.is.null,user_id.eq.${workspace.user.id}`)
  revalidatePath('/notifications')
  revalidatePath('/dashboard')
  redirect(returnTo)
}

export async function markAllNotificationsReadAction() {
  const { workspace, supabase } = await scopedNotificationQuery()
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('organization_id', workspace.organization!.id)
    .is('read_at', null)
    .is('archived_at', null)
    .or(`user_id.is.null,user_id.eq.${workspace.user.id}`)
  revalidatePath('/notifications')
  revalidatePath('/dashboard')
  redirect('/notifications?saved=read')
}

export async function markSelectedNotificationsReadAction(formData: FormData) {
  const ids = formData.getAll('notification_id').map((item) => String(item)).filter(Boolean)
  if (!ids.length) redirect('/notifications')
  const { workspace, supabase } = await scopedNotificationQuery()
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .in('id', ids)
    .eq('organization_id', workspace.organization!.id)
    .or(`user_id.is.null,user_id.eq.${workspace.user.id}`)
  revalidatePath('/notifications')
  redirect('/notifications?saved=read-selected')
}

export async function deleteNotificationAction(formData: FormData) {
  const id = String(formData.get('notification_id') || '').trim()
  const returnTo = safeReturn(formData.get('return_to'))
  if (!id) redirect(returnTo)
  const { workspace, supabase } = await scopedNotificationQuery()
  await supabase
    .from('notifications')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', workspace.organization!.id)
    .or(`user_id.is.null,user_id.eq.${workspace.user.id}`)
  revalidatePath('/notifications')
  revalidatePath('/dashboard')
  redirect(returnTo)
}

export async function deleteSelectedNotificationsAction(formData: FormData) {
  const ids = formData.getAll('notification_id').map((item) => String(item)).filter(Boolean)
  if (!ids.length) redirect('/notifications')
  const { workspace, supabase } = await scopedNotificationQuery()
  await supabase
    .from('notifications')
    .update({ archived_at: new Date().toISOString() })
    .in('id', ids)
    .eq('organization_id', workspace.organization!.id)
    .or(`user_id.is.null,user_id.eq.${workspace.user.id}`)
  revalidatePath('/notifications')
  revalidatePath('/dashboard')
  redirect('/notifications?saved=deleted-selected')
}

export async function deleteAllNotificationsAction() {
  const { workspace, supabase } = await scopedNotificationQuery()
  await supabase
    .from('notifications')
    .update({ archived_at: new Date().toISOString() })
    .eq('organization_id', workspace.organization!.id)
    .is('archived_at', null)
    .or(`user_id.is.null,user_id.eq.${workspace.user.id}`)
  revalidatePath('/notifications')
  revalidatePath('/dashboard')
  redirect('/notifications?saved=deleted-all')
}
