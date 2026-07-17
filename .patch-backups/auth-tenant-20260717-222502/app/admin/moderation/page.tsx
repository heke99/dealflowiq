import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { archiveReportedConversationAction, resolveReportAction } from '@/app/admin/moderation/actions'
import { asRows, firstRow, rowString, type Row } from '@/lib/types/rows'

type Search = Record<string, string | string[] | undefined>

const statusFilters = ['all', 'open', 'reviewed', 'dismissed', 'actioned']

function one(value: string | string[] | undefined, fallback = '') {
  if (Array.isArray(value)) return value[0] || fallback
  return value || fallback
}

function dateText(value?: unknown) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(String(value)))
}

function StatusPill({ value }: { value: string }) {
  const tone = value === 'open'
    ? 'border-amber-400/30 bg-amber-400/10 text-amber-100'
    : value === 'actioned'
      ? 'border-red-400/30 bg-red-400/10 text-red-100'
      : value === 'reviewed'
        ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
        : 'border-slate-400/20 bg-slate-400/10 text-slate-200'
  return <span className={`rounded-full border px-3 py-1 text-xs font-bold uppercase ${tone}`}>{value}</span>
}

export default async function AdminModerationPage({ searchParams }: { searchParams?: Promise<Search> }) {
  const params = await searchParams
  const statusFilter = one(params?.status, 'open')
  const error = one(params?.error)
  const saved = one(params?.saved)
  const workspace = await getCurrentWorkspace()

  if (!workspace.access.isPlatformAdmin) {
    return (
      <AppShell organizationName={workspace.organization?.name} userEmail={workspace.user.email} accountType={workspace.access.accountType} features={workspace.access.features} subscriptionStatus={workspace.access.status} planName={workspace.access.plan?.name} trialEndsAt={workspace.access.trialEndsAt} isPlatformAdmin={workspace.access.isPlatformAdmin}>
        <div className="rounded-3xl border border-amber-500/30 bg-amber-500/10 p-8 text-amber-100">
          <h1 className="text-3xl font-black">Platform admin required</h1>
          <p className="mt-3 text-sm">Only platform admins can review conversation reports.</p>
        </div>
      </AppShell>
    )
  }

  // Service-role reads: moderation needs conversations and reporter profiles
  // from any organization, not only ones the admin belongs to.
  const admin = createSupabaseAdminClient()
  let query = admin
    .from('conversation_reports')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)
  if (statusFilter !== 'all') query = query.eq('status', statusFilter)
  const { data: reportsData } = await query
  const reports = asRows(reportsData)

  const conversationIds = Array.from(new Set(reports.map((report) => String(report.conversation_id)).filter(Boolean)))
  const { data: conversationsData } = conversationIds.length
    ? await admin
        .from('listing_conversations')
        .select('id, listing_id, organization_id, buyer_user_id, owner_user_id, status, last_message_preview, market_listings(title,address,city,state)')
        .in('id', conversationIds)
    : { data: [] as Row[] }
  const conversationById = new Map(asRows(conversationsData).map((conversation) => [String(conversation.id), conversation]))

  const profileIds = Array.from(new Set(reports.flatMap((report) => [rowString(report.reported_by_user_id), rowString(report.reviewed_by)]).filter((id): id is string => Boolean(id))))
  const { data: profilesData } = profileIds.length
    ? await admin.from('profiles').select('id, email, full_name').in('id', profileIds)
    : { data: [] as Row[] }
  const profileById = new Map(asRows(profilesData).map((profile) => [String(profile.id), profile]))

  const openCount = reports.filter((report) => report.status === 'open').length

  return (
    <AppShell organizationName={workspace.organization?.name} userEmail={workspace.user.email} accountType={workspace.access.accountType} features={workspace.access.features} subscriptionStatus={workspace.access.status} planName={workspace.access.plan?.name} trialEndsAt={workspace.access.trialEndsAt} isPlatformAdmin={workspace.access.isPlatformAdmin}>
      <div className="space-y-6">
        <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900 via-slate-950 to-black p-6 sm:p-8">
          <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
            <div>
              <div className="text-sm font-medium uppercase tracking-wide text-red-300">Community safety</div>
              <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-5xl">Moderation queue</h1>
              <p className="mt-4 max-w-3xl text-slate-300">Reported listing conversations land here. Resolve each report and archive abusive threads to hide them from inboxes.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><div className="text-xs text-slate-500">Showing</div><div className="mt-1 text-2xl font-black">{reports.length}</div></div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><div className="text-xs text-slate-500">Open</div><div className="mt-1 text-2xl font-black text-amber-200">{openCount}</div></div>
            </div>
          </div>
        </section>

        {error ? <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">{error}</div> : null}
        {saved ? <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">Saved: {saved}</div> : null}

        <section className="flex flex-wrap gap-2">
          {statusFilters.map((item) => (
            <Link key={item} href={`/admin/moderation?status=${item}`} className={`rounded-full border px-4 py-2 text-sm font-semibold capitalize ${statusFilter === item ? 'border-white/30 bg-white text-slate-950' : 'border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/10'}`}>{item}</Link>
          ))}
        </section>

        <section className="space-y-3">
          {reports.map((report) => {
            const conversation = conversationById.get(String(report.conversation_id))
            const listing = firstRow(conversation?.market_listings)
            const reporter = profileById.get(String(report.reported_by_user_id))
            const reviewer = report.reviewed_by ? profileById.get(String(report.reviewed_by)) : null
            const conversationStatus = String(conversation?.status || 'unknown')
            return (
              <article key={String(report.id)} className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="line-clamp-1 text-lg font-bold text-white">{rowString(listing?.title) || rowString(listing?.address) || 'Listing conversation'}</h2>
                      <StatusPill value={String(report.status || 'open')} />
                      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-300">Thread: {conversationStatus.replaceAll('_', ' ')}</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-400">Reported by {rowString(reporter?.email) || 'unknown user'} · {dateText(report.created_at)}</p>
                    <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm leading-6 text-slate-200">{String(report.reason || '')}</div>
                    {conversation?.last_message_preview ? <p className="mt-2 line-clamp-1 text-xs text-slate-500">Last message: {String(conversation.last_message_preview)}</p> : null}
                    {report.reviewed_at ? <p className="mt-2 text-xs text-slate-500">Resolved by {rowString(reviewer?.email) || 'admin'} · {dateText(report.reviewed_at)}</p> : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2 lg:max-w-xs lg:justify-end">
                    {conversation ? <Link href={`/messages/${conversation.id}`} className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-950 hover:bg-slate-200">Open thread</Link> : null}
                    {['reviewed', 'dismissed', 'actioned'].map((resolution) => (
                      <form key={resolution} action={resolveReportAction}>
                        <input type="hidden" name="report_id" value={String(report.id)} />
                        <input type="hidden" name="resolution" value={resolution} />
                        <button className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold capitalize text-slate-200 hover:bg-white/10">{resolution}</button>
                      </form>
                    ))}
                    {conversation && conversationStatus !== 'archived' ? (
                      <form action={archiveReportedConversationAction}>
                        <input type="hidden" name="conversation_id" value={String(conversation.id)} />
                        <button className="rounded-xl border border-red-400/30 px-4 py-2 text-sm font-semibold text-red-100 hover:bg-red-400/10">Archive conversation</button>
                      </form>
                    ) : null}
                  </div>
                </div>
              </article>
            )
          })}
          {!reports.length ? <div className="rounded-3xl border border-dashed border-white/15 bg-white/[0.03] p-10 text-center text-slate-500">No reports in this filter. Reported conversations from the Messages thread page appear here.</div> : null}
        </section>
      </div>
    </AppShell>
  )
}
