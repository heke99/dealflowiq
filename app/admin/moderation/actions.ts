'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requirePlatformAdmin } from '@/lib/auth/admin'
import { requireUser } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { recordAuditEvent } from '@/lib/audit'

const RESOLUTIONS = ['reviewed', 'dismissed', 'actioned'] as const
type Resolution = (typeof RESOLUTIONS)[number]

function isResolution(value: string): value is Resolution {
  return (RESOLUTIONS as readonly string[]).includes(value)
}

export async function resolveReportAction(formData: FormData) {
  await requirePlatformAdmin()
  const actor = await requireUser()
  const reportId = String(formData.get('report_id') || '').trim()
  const resolution = String(formData.get('resolution') || '').trim()
  if (!reportId || !isResolution(resolution)) redirect('/admin/moderation?error=Pick a valid resolution')

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('conversation_reports')
    .update({ status: resolution, reviewed_by: actor.id, reviewed_at: new Date().toISOString() })
    .eq('id', reportId)
  if (error) redirect(`/admin/moderation?error=${encodeURIComponent(error.message)}`)

  await recordAuditEvent({
    actorId: actor.id,
    eventType: 'conversation_report.resolved',
    entityType: 'conversation_report',
    entityId: reportId,
    metadata: { resolution },
  })

  revalidatePath('/admin/moderation')
  redirect(`/admin/moderation?saved=${encodeURIComponent(resolution)}`)
}

export async function archiveReportedConversationAction(formData: FormData) {
  await requirePlatformAdmin()
  const actor = await requireUser()
  const conversationId = String(formData.get('conversation_id') || '').trim()
  if (!conversationId) redirect('/admin/moderation?error=Missing conversation id')

  // Service-role client: the moderating admin is usually not a participant
  // of the reported conversation, so a user-context update could be blocked.
  const admin = createSupabaseAdminClient()
  const { error } = await admin
    .from('listing_conversations')
    .update({ status: 'archived' })
    .eq('id', conversationId)
  if (error) redirect(`/admin/moderation?error=${encodeURIComponent(error.message)}`)

  await recordAuditEvent({
    actorId: actor.id,
    eventType: 'conversation.archived_by_moderation',
    entityType: 'listing_conversation',
    entityId: conversationId,
  })

  revalidatePath('/admin/moderation')
  revalidatePath('/messages')
  redirect('/admin/moderation?saved=archived')
}
