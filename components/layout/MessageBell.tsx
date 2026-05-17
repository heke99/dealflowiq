import Link from 'next/link'
import { MessageCircle } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentWorkspace } from '@/lib/auth/workspace'

type Row = Record<string, any>

function dateText(value?: string | null) {
  if (!value) return ''
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

function listingTitle(conversation: Row) {
  const listing = Array.isArray(conversation.market_listings) ? conversation.market_listings[0] : conversation.market_listings
  return listing?.title || listing?.address || 'Listing conversation'
}

export async function MessageBell() {
  let conversations: Row[] = []
  let unread = 0

  try {
    const workspace = await getCurrentWorkspace()
    const supabase = await createSupabaseServerClient()
    const { data } = await supabase
      .from('listing_conversations')
      .select('id, listing_id, buyer_user_id, owner_user_id, status, last_message_preview, last_message_at, created_at, market_listings(title,address,city,state)')
      .or(`buyer_user_id.eq.${workspace.user.id},owner_user_id.eq.${workspace.user.id}`)
      .neq('status', 'archived')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(8)

    conversations = (data || []) as Row[]
    const ids = conversations.map((item) => String(item.id))
    if (ids.length) {
      const { count } = await supabase
        .from('listing_messages')
        .select('id', { count: 'exact', head: true })
        .in('conversation_id', ids)
        .neq('sender_user_id', workspace.user.id)
        .is('read_at', null)
      unread = count || 0
    }
  } catch {
    conversations = []
    unread = 0
  }

  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10">
        <span className="relative inline-flex">
          <MessageCircle className="h-4 w-4" />
          {unread ? <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-sky-300 px-1 text-[10px] font-black text-slate-950">{unread > 9 ? '9+' : unread}</span> : null}
        </span>
        <span className="hidden sm:inline">Messages</span>
      </summary>
      <div className="absolute right-0 z-40 mt-3 w-80 overflow-hidden rounded-2xl border border-white/10 bg-slate-950 shadow-2xl shadow-black/50">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 p-4">
          <div>
            <div className="font-bold text-white">Messages</div>
            <div className="text-xs text-slate-500">{unread} unread</div>
          </div>
          <Link href="/messages" className="text-xs font-semibold text-slate-300 hover:text-white">View all</Link>
        </div>
        <div className="max-h-96 overflow-y-auto p-2">
          {conversations.length ? conversations.map((item) => (
            <Link key={item.id} href={`/messages/${item.id}`} className="block rounded-xl border border-white/10 bg-white/[0.03] p-3 transition hover:bg-white/[0.07]">
              <div className="line-clamp-1 text-sm font-semibold text-white">{listingTitle(item)}</div>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">{item.last_message_preview || 'Open conversation'}</p>
              <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-slate-600">
                <span>{String(item.status || 'new').replaceAll('_', ' ')}</span>
                <span>{dateText(item.last_message_at || item.created_at)}</span>
              </div>
            </Link>
          )) : <div className="p-6 text-center text-sm text-slate-500">No conversations yet.</div>}
        </div>
      </div>
    </details>
  )
}
