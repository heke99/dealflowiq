import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'

type Row = Record<string, any>
type Search = Record<string, string | string[] | undefined>

function one(value: string | string[] | undefined, fallback = '') {
  if (Array.isArray(value)) return value[0] || fallback
  return value || fallback
}

function dateText(value?: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

function money(value: number | string | null | undefined) {
  const parsed = Number(value || 0)
  if (!parsed) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, notation: 'compact' }).format(parsed)
}

function listingFrom(conversation: Row) {
  return (Array.isArray(conversation.market_listings) ? conversation.market_listings[0] : conversation.market_listings) || {}
}

export default async function MessagesPage({ searchParams }: { searchParams?: Promise<Search> }) {
  const params = await searchParams
  const status = one(params?.status, 'all')
  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()

  let query = supabase
    .from('listing_conversations')
    .select('*, market_listings(id,title,address,city,state,zip_code,list_price,asking_price,primary_image_url,source_url)')
    .or(`buyer_user_id.eq.${workspace.user.id},owner_user_id.eq.${workspace.user.id}`)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(80)

  if (status !== 'all') query = query.eq('status', status)
  const { data } = await query
  const conversations = (data || []) as Row[]
  const ids = conversations.map((item) => String(item.id))
  const { data: unreadRows } = ids.length
    ? await supabase
        .from('listing_messages')
        .select('conversation_id')
        .in('conversation_id', ids)
        .neq('sender_user_id', workspace.user.id)
        .is('read_at', null)
    : { data: [] as Row[] }

  const unreadByConversation = new Map<string, number>()
  for (const row of (unreadRows || []) as Row[]) {
    const key = String(row.conversation_id)
    unreadByConversation.set(key, (unreadByConversation.get(key) || 0) + 1)
  }

  const totalUnread = Array.from(unreadByConversation.values()).reduce((sum, value) => sum + value, 0)
  const activeCount = conversations.filter((item) => !['closed', 'rejected', 'archived'].includes(String(item.status))).length

  return (
    <AppShell
      organizationName={workspace.organization?.name}
      userEmail={workspace.user.email}
      accountType={workspace.access.accountType}
      features={workspace.access.features}
      subscriptionStatus={workspace.access.status}
      planName={workspace.access.plan?.name}
      trialEndsAt={workspace.access.trialEndsAt}
      isPlatformAdmin={workspace.access.isPlatformAdmin}
    >
      <div className="space-y-6">
        <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900 via-slate-950 to-black p-6 sm:p-8">
          <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
            <div>
              <div className="text-sm font-medium uppercase tracking-wide text-sky-300">Deal conversations</div>
              <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-5xl">Messages</h1>
              <p className="mt-4 max-w-3xl text-slate-300">Every conversation is tied to a listing, so you always know which opportunity the message belongs to.</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><div className="text-xs text-slate-500">Conversations</div><div className="mt-1 text-2xl font-black">{conversations.length}</div></div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><div className="text-xs text-slate-500">Unread</div><div className="mt-1 text-2xl font-black text-sky-200">{totalUnread}</div></div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><div className="text-xs text-slate-500">Active</div><div className="mt-1 text-2xl font-black text-emerald-200">{activeCount}</div></div>
            </div>
          </div>
        </section>

        <section className="flex flex-wrap gap-2">
          {['all', 'new', 'contacted', 'replied', 'offer_submitted', 'under_contract', 'closed', 'archived'].map((item) => (
            <Link key={item} href={`/messages?status=${item}`} className={`rounded-full border px-4 py-2 text-sm font-semibold ${status === item ? 'border-white/30 bg-white text-slate-950' : 'border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/10'}`}>{item.replaceAll('_', ' ')}</Link>
          ))}
        </section>

        <section className="space-y-3">
          {conversations.map((conversation) => {
            const listing = listingFrom(conversation)
            const unread = unreadByConversation.get(String(conversation.id)) || 0
            const location = [listing.city, listing.state, listing.zip_code].filter(Boolean).join(', ') || listing.address || 'Location pending'
            return (
              <Link key={conversation.id} href={`/messages/${conversation.id}`} className="block rounded-3xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-white/20 hover:bg-white/[0.06]">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex min-w-0 gap-4">
                    {listing.primary_image_url ? <div className="h-20 w-24 shrink-0 rounded-2xl bg-cover bg-center" style={{ backgroundImage: `url(${listing.primary_image_url})` }} /> : <div className="flex h-20 w-24 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-slate-900 text-xs text-slate-500">No image</div>}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="line-clamp-1 text-lg font-bold text-white">{listing.title || listing.address || 'Listing conversation'}</h2>
                        {unread ? <span className="rounded-full bg-sky-300 px-2 py-0.5 text-[11px] font-black text-slate-950">{unread} unread</span> : null}
                      </div>
                      <p className="mt-1 text-sm text-slate-400">{location} · {money(listing.list_price || listing.asking_price)}</p>
                      <p className="mt-2 line-clamp-1 text-sm text-slate-500">{conversation.last_message_preview || 'Open the conversation'}</p>
                    </div>
                  </div>
                  <div className="shrink-0 text-left md:text-right">
                    <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200">{String(conversation.status || 'new').replaceAll('_', ' ')}</div>
                    <div className="mt-2 text-xs text-slate-500">{dateText(conversation.last_message_at || conversation.created_at)}</div>
                  </div>
                </div>
              </Link>
            )
          })}
          {!conversations.length ? <div className="rounded-3xl border border-dashed border-white/15 bg-white/[0.03] p-10 text-center text-slate-500">No listing conversations yet. Open a listing and use Contact owner to start one.</div> : null}
        </section>
      </div>
    </AppShell>
  )
}
