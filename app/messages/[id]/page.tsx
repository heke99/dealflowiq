import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { replyListingConversationAction, reportConversationAction, updateConversationStatusAction } from '@/app/messages/actions'
import { hasFullOpportunityAccess } from '@/lib/billing/freemium'

type Row = Record<string, any>

function dateTime(value?: string | null) {
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

export default async function MessageConversationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params
  const qs = await searchParams
  const error = typeof qs?.error === 'string' ? qs.error : ''
  const reported = qs?.reported === '1'
  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()

  const { data: conversation } = await supabase
    .from('listing_conversations')
    .select('*, market_listings(id,title,address,city,state,zip_code,list_price,asking_price,primary_image_url,source_url,latest_deal_score,latest_estimated_monthly_cashflow,latest_estimated_dscr)')
    .eq('id', id)
    .maybeSingle()

  if (!conversation) notFound()
  const row = conversation as Row
  if (![row.buyer_user_id, row.owner_user_id].includes(workspace.user.id) && !workspace.access.isPlatformAdmin) redirect('/messages')

  await supabase
    .from('listing_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('conversation_id', id)
    .neq('sender_user_id', workspace.user.id)
    .is('read_at', null)

  const { data: messagesData } = await supabase
    .from('listing_messages')
    .select('*')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true })

  const messages = (messagesData || []) as Row[]
  const listing = listingFrom(row)
  const isFullMessaging = hasFullOpportunityAccess(workspace.access)
  const location = [listing.address, listing.city, listing.state, listing.zip_code].filter(Boolean).join(', ') || 'Location pending'

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
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 gap-4">
              {listing.primary_image_url ? <div className="h-24 w-32 shrink-0 rounded-2xl bg-cover bg-center" style={{ backgroundImage: `url(${listing.primary_image_url})` }} /> : <div className="flex h-24 w-32 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-slate-900 text-xs text-slate-500">No image</div>}
              <div className="min-w-0">
                <Link href="/messages" className="text-sm font-medium text-slate-400 hover:text-white">← Back to Messages</Link>
                <h1 className="mt-2 line-clamp-2 text-2xl font-black text-white">{listing.title || listing.address || 'Listing conversation'}</h1>
                <p className="mt-1 text-sm text-slate-400">{location}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-300">{money(listing.list_price || listing.asking_price)}</span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-300">Status: {String(row.status || 'new').replaceAll('_', ' ')}</span>
                  {listing.latest_deal_score ? <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-emerald-100">Score {Math.round(Number(listing.latest_deal_score))}</span> : null}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/market/${listing.id}`} className="rounded-xl bg-white px-4 py-3 text-sm font-bold text-slate-950 hover:bg-slate-200">View listing</Link>
              {listing.source_url ? <a href={listing.source_url} target="_blank" rel="noreferrer" className="rounded-xl border border-white/10 px-4 py-3 text-sm font-bold text-slate-200 hover:bg-white/10">Source</a> : null}
            </div>
          </div>
        </section>

        {error ? <div className="rounded-2xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm text-amber-100">{error}</div> : null}
        {reported ? <div className="rounded-2xl border border-emerald-400/25 bg-emerald-400/10 p-4 text-sm text-emerald-100">Conversation reported. Super admin can review it from moderation.</div> : null}
        {!isFullMessaging ? <div className="rounded-2xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm text-amber-100">Free plan messaging: you can send 1 message every 48 hours. Upgrade to Pro for full listing conversations.</div> : null}

        <section className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
            <div className="space-y-4">
              {messages.map((message) => {
                const own = message.sender_user_id === workspace.user.id
                return (
                  <div key={message.id} className={`flex ${own ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-3xl border p-4 ${own ? 'border-sky-300/20 bg-sky-300/10 text-sky-50' : 'border-white/10 bg-slate-950/60 text-slate-100'}`}>
                      <p className="whitespace-pre-wrap text-sm leading-6">{message.body}</p>
                      <div className="mt-2 text-[11px] text-slate-500">{dateTime(message.created_at)}{own && message.read_at ? ' · read' : ''}</div>
                    </div>
                  </div>
                )
              })}
              {!messages.length ? <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-slate-500">No messages yet.</div> : null}
            </div>

            <form action={replyListingConversationAction} className="mt-6 rounded-2xl border border-white/10 bg-slate-950/60 p-4">
              <input type="hidden" name="conversation_id" value={id} />
              <label className="text-sm font-semibold text-slate-300">Reply</label>
              <textarea name="body" rows={4} required placeholder="Write your reply..." className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-white/30" />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-slate-500">Messages stay inside DealFlowIQ. Email/SMS sending is not enabled.</p>
                <button className="rounded-xl bg-white px-5 py-3 text-sm font-bold text-slate-950 hover:bg-slate-200">Send reply</button>
              </div>
            </form>
          </div>

          <aside className="space-y-4">
            <form action={updateConversationStatusAction} className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
              <input type="hidden" name="conversation_id" value={id} />
              <label className="text-sm font-semibold text-slate-300">Conversation status</label>
              <select name="status" defaultValue={row.status || 'new'} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none">
                <option value="new">New</option>
                <option value="replied">Replied</option>
                <option value="contacted">Contacted</option>
                <option value="offer_discussed">Offer discussed</option>
                <option value="offer_submitted">Offer submitted</option>
                <option value="under_contract">Under contract</option>
                <option value="closed">Closed</option>
                <option value="rejected">Rejected</option>
                <option value="archived">Archived</option>
              </select>
              <button className="mt-3 w-full rounded-xl border border-white/10 px-4 py-3 text-sm font-bold text-slate-200 hover:bg-white/10">Update status</button>
            </form>

            <form action={reportConversationAction} className="rounded-3xl border border-red-400/20 bg-red-400/5 p-5">
              <input type="hidden" name="conversation_id" value={id} />
              <label className="text-sm font-semibold text-red-100">Report conversation</label>
              <textarea name="reason" rows={3} required placeholder="What should admin review?" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600" />
              <button className="mt-3 w-full rounded-xl border border-red-400/30 px-4 py-3 text-sm font-bold text-red-100 hover:bg-red-400/10">Report</button>
            </form>
          </aside>
        </section>
      </div>
    </AppShell>
  )
}
