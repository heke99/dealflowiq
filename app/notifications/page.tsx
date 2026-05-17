import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { deleteAllNotificationsAction, deleteNotificationAction, deleteSelectedNotificationsAction, markAllNotificationsReadAction, markNotificationReadAction, markSelectedNotificationsReadAction } from '@/app/notifications/actions'

type Row = Record<string, any>
type Search = Record<string, string | string[] | undefined>

const filters = [
  ['all', 'All'],
  ['unread', 'Unread'],
  ['buy_box_match', 'Buy Box Matches'],
  ['opportunity_found', 'Deals'],
  ['community', 'Community'],
  ['billing', 'Billing'],
  ['message_received', 'Messages'],
  ['system', 'System'],
]

function one(value: string | string[] | undefined, fallback = '') {
  if (Array.isArray(value)) return value[0] || fallback
  return value || fallback
}

function dateText(value?: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

function typeLabel(value?: string | null) {
  return String(value || 'system').replaceAll('_', ' ')
}

function filterQuery(query: any, filter: string) {
  if (filter === 'unread') return query.is('read_at', null)
  if (filter === 'community') return query.in('type', ['community_deal', 'community_activity'])
  if (filter === 'billing') return query.in('type', ['trial_ending', 'payment_required', 'subscription_updated'])
  if (filter === 'system') return query.in('type', ['system', 'system_alert', 'admin_alert'])
  if (filter !== 'all') return query.eq('type', filter)
  return query
}

export default async function NotificationsPage({ searchParams }: { searchParams?: Promise<Search> }) {
  const params = await searchParams
  const activeFilter = one(params?.type, 'all')
  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()

  let query = supabase
    .from('notifications')
    .select('*')
    .eq('organization_id', workspace.organization?.id || '00000000-0000-0000-0000-000000000000')
    .or(`user_id.is.null,user_id.eq.${workspace.user.id}`)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(120)

  query = filterQuery(query, activeFilter)
  const { data } = await query
  const notifications = (data || []) as Row[]
  const unreadCount = notifications.filter((item) => !item.read_at).length

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
              <div className="text-sm font-medium uppercase tracking-wide text-emerald-300">Alerts center</div>
              <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-5xl">Notifications</h1>
              <p className="mt-4 max-w-3xl text-slate-300">Buy Box matches, deal alerts, community updates, payment/trial notices and system alerts in one place.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><div className="text-xs text-slate-500">Showing</div><div className="mt-1 text-2xl font-black">{notifications.length}</div></div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><div className="text-xs text-slate-500">Unread</div><div className="mt-1 text-2xl font-black text-emerald-200">{unreadCount}</div></div>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-white/[0.03] p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {filters.map(([value, label]) => (
              <Link key={value} href={`/notifications?type=${value}`} className={`rounded-full border px-4 py-2 text-sm font-semibold ${activeFilter === value ? 'border-white/30 bg-white text-slate-950' : 'border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/10'}`}>{label}</Link>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <form action={markAllNotificationsReadAction}><button className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10">Mark all read</button></form>
            <form action={deleteAllNotificationsAction}><button className="rounded-xl border border-red-400/25 px-4 py-2 text-sm font-semibold text-red-100 hover:bg-red-400/10">Delete all</button></form>
          </div>
        </section>

        <div className="space-y-3">
          <form id="bulk-notifications-form" className="flex flex-wrap gap-2 rounded-2xl border border-white/10 bg-slate-950/60 p-3">
            <button formAction={markSelectedNotificationsReadAction} className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10">Mark selected read</button>
            <button formAction={deleteSelectedNotificationsAction} className="rounded-xl border border-red-400/25 px-4 py-2 text-sm font-semibold text-red-100 hover:bg-red-400/10">Delete selected</button>
          </form>

          {notifications.map((item) => (
            <article key={item.id} className={`rounded-3xl border p-4 ${item.read_at ? 'border-white/10 bg-white/[0.025]' : 'border-emerald-400/25 bg-emerald-400/[0.06]'}`}>
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="flex min-w-0 gap-3">
                  <input form="bulk-notifications-form" type="checkbox" name="notification_id" value={item.id} className="mt-1 h-4 w-4 rounded border-white/20 bg-slate-900" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="line-clamp-1 text-lg font-bold text-white">{item.title}</h2>
                      {!item.read_at ? <span className="rounded-full bg-emerald-300 px-2 py-0.5 text-[11px] font-black text-slate-950">New</span> : null}
                      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-300">{typeLabel(item.type)}</span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{item.message}</p>
                    <div className="mt-2 text-xs text-slate-600">{dateText(item.created_at)}</div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2 md:justify-end">
                  {item.action_href ? <Link href={String(item.action_href)} className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-slate-200">Open</Link> : null}
                  {!item.read_at ? (
                    <form action={markNotificationReadAction}><input type="hidden" name="notification_id" value={item.id} /><input type="hidden" name="return_to" value="/notifications" /><button className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10">Read</button></form>
                  ) : null}
                  <form action={deleteNotificationAction}><input type="hidden" name="notification_id" value={item.id} /><input type="hidden" name="return_to" value="/notifications" /><button className="rounded-xl border border-red-400/25 px-4 py-2 text-sm font-semibold text-red-100 hover:bg-red-400/10">Delete</button></form>
                </div>
              </div>
            </article>
          ))}
          {!notifications.length ? <div className="rounded-3xl border border-dashed border-white/15 bg-white/[0.03] p-10 text-center text-slate-500">No notifications in this filter.</div> : null}
        </div>
      </div>
    </AppShell>
  )
}
