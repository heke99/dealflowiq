'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createInAppNotification } from '@/lib/notifications'
import { hasFullOpportunityAccess } from '@/lib/billing/freemium'

const FREE_MESSAGE_COOLDOWN_HOURS = 48

type Row = Record<string, any>

function cleanText(value: FormDataEntryValue | null, max = 4000) {
  return String(value || '').trim().slice(0, max)
}

function isAdminRole(role?: string | null) {
  return ['owner', 'admin'].includes(String(role || '').toLowerCase())
}

function canManageListingContact(workspace: Awaited<ReturnType<typeof getCurrentWorkspace>>, listing: Row) {
  return Boolean(
    workspace.access.isPlatformAdmin
      || listing.created_by === workspace.user.id
      || (listing.organization_id && listing.organization_id === workspace.organization?.id && isAdminRole(workspace.membership?.role)),
  )
}

async function getListingOwner(params: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>
  listing: Row
}) {
  if (params.listing.created_by) return String(params.listing.created_by)
  if (!params.listing.organization_id) return null
  const { data } = await params.supabase
    .from('organizations')
    .select('owner_id')
    .eq('id', params.listing.organization_id)
    .maybeSingle()
  return (data as Row | null)?.owner_id ? String((data as Row).owner_id) : null
}

async function enforceFreeMessageLimit(params: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>
  userId: string
  hasFullMessagingAccess: boolean
  returnTo: string
}) {
  if (params.hasFullMessagingAccess) return
  const { data } = await params.supabase
    .from('listing_messages')
    .select('created_at')
    .eq('sender_user_id', params.userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const lastMessageAt = (data as Row | null)?.created_at
  if (!lastMessageAt) return
  const nextUnlock = new Date(new Date(String(lastMessageAt)).getTime() + FREE_MESSAGE_COOLDOWN_HOURS * 60 * 60 * 1000)
  if (nextUnlock.getTime() > Date.now()) {
    const message = `Free users can send 1 message every 48 hours. Your next message unlocks ${nextUnlock.toLocaleString()}. Upgrade to Pro for full listing conversations.`
    redirect(`${params.returnTo}${params.returnTo.includes('?') ? '&' : '?'}error=${encodeURIComponent(message)}`)
  }
}

async function ensureConversation(params: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>
  listing: Row
  buyerUserId: string
  ownerUserId: string
}) {
  const organizationId = params.listing.organization_id || null
  const { data: existing } = await params.supabase
    .from('listing_conversations')
    .select('*')
    .eq('listing_id', params.listing.id)
    .eq('buyer_user_id', params.buyerUserId)
    .eq('owner_user_id', params.ownerUserId)
    .maybeSingle()

  if (existing) return existing as Row

  const { data, error } = await params.supabase
    .from('listing_conversations')
    .insert({
      listing_id: params.listing.id,
      organization_id: organizationId,
      buyer_user_id: params.buyerUserId,
      owner_user_id: params.ownerUserId,
      status: 'new',
      last_message_at: new Date().toISOString(),
    })
    .select('*')
    .single()

  if (error || !data) throw new Error(error?.message || 'Could not create listing conversation')
  return data as Row
}

async function sendMessage(params: {
  conversation: Row
  listing: Row
  senderUserId: string
  recipientUserId: string
  body: string
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>
}) {
  const now = new Date().toISOString()
  const { data: message, error } = await params.supabase
    .from('listing_messages')
    .insert({
      conversation_id: params.conversation.id,
      listing_id: params.listing.id,
      organization_id: params.listing.organization_id || null,
      sender_user_id: params.senderUserId,
      body: params.body,
    })
    .select('*')
    .single()

  if (error || !message) throw new Error(error?.message || 'Could not send message')

  await params.supabase
    .from('listing_conversations')
    .update({
      last_message_at: now,
      last_message_preview: params.body.slice(0, 180),
      status: params.senderUserId === params.conversation.owner_user_id ? 'replied' : params.conversation.status === 'new' ? 'contacted' : params.conversation.status,
    })
    .eq('id', params.conversation.id)

  if (params.listing.organization_id) {
    await createInAppNotification(params.supabase, {
      organizationId: params.listing.organization_id,
      userId: params.recipientUserId,
      actorId: params.senderUserId,
      type: 'message_received',
      title: 'New listing message',
      message: `${params.listing.title || 'A listing'} received a new message.`,
      relatedEntityType: 'listing_conversation',
      relatedEntityId: params.conversation.id,
      actionHref: `/messages/${params.conversation.id}`,
      metadata: { listingId: params.listing.id, conversationId: params.conversation.id },
    })
  }

  return message as Row
}

export async function startListingConversationAction(formData: FormData) {
  const listingId = cleanText(formData.get('listing_id'), 100)
  const body = cleanText(formData.get('body'))
  const returnTo = listingId ? `/market/${listingId}#contact-owner` : '/market'
  if (!listingId || !body) redirect(`${returnTo}?error=${encodeURIComponent('Write a message before sending.')}`)

  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()
  const { data: listing } = await supabase.from('market_listings').select('*').eq('id', listingId).maybeSingle()
  if (!listing) redirect(`/market?error=${encodeURIComponent('Listing was not found.')}`)

  const { data: settings } = await supabase
    .from('listing_contact_settings')
    .select('*')
    .eq('listing_id', listingId)
    .maybeSingle()

  if ((settings as Row | null)?.allow_in_app_messages === false) {
    redirect(`${returnTo}?error=${encodeURIComponent('This listing owner has disabled in-app messages.')}`)
  }

  const ownerUserId = await getListingOwner({ supabase, listing: listing as Row })
  if (!ownerUserId) redirect(`${returnTo}?error=${encodeURIComponent('This listing does not have a contact owner yet.')}`)
  if (ownerUserId === workspace.user.id) redirect(`${returnTo}?error=${encodeURIComponent('You cannot start a conversation with yourself on your own listing.')}`)

  await enforceFreeMessageLimit({ supabase, userId: workspace.user.id, hasFullMessagingAccess: hasFullOpportunityAccess(workspace.access), returnTo })

  const conversation = await ensureConversation({ supabase, listing: listing as Row, buyerUserId: workspace.user.id, ownerUserId })
  await sendMessage({ conversation, listing: listing as Row, senderUserId: workspace.user.id, recipientUserId: ownerUserId, body, supabase })

  revalidatePath('/messages')
  revalidatePath(`/market/${listingId}`)
  redirect(`/messages/${conversation.id}`)
}

export async function replyListingConversationAction(formData: FormData) {
  const conversationId = cleanText(formData.get('conversation_id'), 100)
  const body = cleanText(formData.get('body'))
  const returnTo = conversationId ? `/messages/${conversationId}` : '/messages'
  if (!conversationId || !body) redirect(`${returnTo}?error=${encodeURIComponent('Write a message before sending.')}`)

  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()
  const { data: conversation } = await supabase
    .from('listing_conversations')
    .select('*, market_listings(*)')
    .eq('id', conversationId)
    .maybeSingle()

  if (!conversation) redirect('/messages?error=Conversation not found')
  const row = conversation as Row
  if (![row.buyer_user_id, row.owner_user_id].includes(workspace.user.id) && !workspace.access.isPlatformAdmin) {
    redirect('/messages?error=You do not have access to this conversation')
  }

  await enforceFreeMessageLimit({ supabase, userId: workspace.user.id, hasFullMessagingAccess: hasFullOpportunityAccess(workspace.access), returnTo })

  const listing = (Array.isArray(row.market_listings) ? row.market_listings[0] : row.market_listings) || { id: row.listing_id, organization_id: row.organization_id, title: 'Listing' }
  const recipientUserId = workspace.user.id === row.buyer_user_id ? row.owner_user_id : row.buyer_user_id
  await sendMessage({ conversation: row, listing, senderUserId: workspace.user.id, recipientUserId, body, supabase })

  revalidatePath('/messages')
  revalidatePath(`/messages/${conversationId}`)
  redirect(`/messages/${conversationId}`)
}

export async function updateConversationStatusAction(formData: FormData) {
  const conversationId = cleanText(formData.get('conversation_id'), 100)
  const status = cleanText(formData.get('status'), 40)
  const allowed = ['new', 'replied', 'contacted', 'offer_discussed', 'offer_submitted', 'under_contract', 'closed', 'rejected', 'archived']
  if (!conversationId || !allowed.includes(status)) redirect('/messages')
  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()
  const { data: conversation } = await supabase.from('listing_conversations').select('*').eq('id', conversationId).maybeSingle()
  const row = conversation as Row | null
  if (!row || (![row.buyer_user_id, row.owner_user_id].includes(workspace.user.id) && !workspace.access.isPlatformAdmin)) redirect('/messages')
  await supabase.from('listing_conversations').update({ status }).eq('id', conversationId)
  revalidatePath('/messages')
  revalidatePath(`/messages/${conversationId}`)
  redirect(`/messages/${conversationId}`)
}

export async function updateListingContactSettingsAction(formData: FormData) {
  const listingId = cleanText(formData.get('listing_id'), 100)
  if (!listingId) redirect('/market')
  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()
  const { data: listing } = await supabase.from('market_listings').select('*').eq('id', listingId).maybeSingle()
  if (!listing || !canManageListingContact(workspace, listing as Row)) redirect(`/market/${listingId}?error=${encodeURIComponent('You cannot manage contact settings for this listing.')}`)

  const payload = {
    listing_id: listingId,
    organization_id: (listing as Row).organization_id || workspace.organization?.id || null,
    allow_in_app_messages: formData.get('allow_in_app_messages') === 'on',
    contact_email: cleanText(formData.get('contact_email'), 320) || null,
    contact_phone: cleanText(formData.get('contact_phone'), 80) || null,
    email_visibility: ['hidden', 'paid_only', 'all_logged_in'].includes(cleanText(formData.get('email_visibility'), 40)) ? cleanText(formData.get('email_visibility'), 40) : 'hidden',
    phone_visibility: ['hidden', 'paid_only', 'all_logged_in'].includes(cleanText(formData.get('phone_visibility'), 40)) ? cleanText(formData.get('phone_visibility'), 40) : 'hidden',
    preferred_contact_method: ['in_app', 'email', 'phone'].includes(cleanText(formData.get('preferred_contact_method'), 40)) ? cleanText(formData.get('preferred_contact_method'), 40) : 'in_app',
    updated_by: workspace.user.id,
  }

  await supabase
    .from('listing_contact_settings')
    .upsert({ ...payload, created_by: workspace.user.id }, { onConflict: 'listing_id' })

  revalidatePath(`/market/${listingId}`)
  redirect(`/market/${listingId}#contact-owner`)
}

export async function reportConversationAction(formData: FormData) {
  const conversationId = cleanText(formData.get('conversation_id'), 100)
  const reason = cleanText(formData.get('reason'), 1000)
  if (!conversationId || !reason) redirect(conversationId ? `/messages/${conversationId}` : '/messages')
  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()
  await supabase.from('conversation_reports').insert({ conversation_id: conversationId, reported_by_user_id: workspace.user.id, reason })
  revalidatePath(`/messages/${conversationId}`)
  redirect(`/messages/${conversationId}?reported=1`)
}
