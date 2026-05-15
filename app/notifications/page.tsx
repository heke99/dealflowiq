import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { markAllNotificationsReadAction, markNotificationReadAction } from '@/app/notifications/actions'

type Row = Record<string, any>

function dateText(value?: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

export default async function NotificationsPage() {
  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()
  const { data, error } = workspace.organization?.id
    ? await supabase
        .from('notifications')
        .select('*')
        .eq('organization_id', workspace.organization.id)
        .or(`user_id.is.null,user_id.eq.${workspace.user.id}`)
        .is('archived_at', null)
        .order('created_at', { ascending: false })
        .limit(100)
    : { data: [] as Row[], error: null }
  const rows = (data || []) as Row[]
  const unread = rows.filter((row) => !row.read_at).length

  return (
    <AppShell organizationName={workspace.organization?.name} userEmail={workspace.user.email} accountType={workspace.access.accountType} features={workspace.access.features} subscriptionStatus={workspace.access.status} planName={workspace.access.plan?.name} trialEndsAt={workspace.access.trialEndsAt} isPlatformAdmin={workspace.access.isPlatformAdmin}>
      <div className="space-y-6">
        <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900 via-slate-950 to-black p-6 sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-sm font-bold uppercase tracking-wide text-emerald-300">In-app only</div>
              <h1 className="mt-2 text-4xl font-black tracking-tight">Notifications</h1>
              <p className="mt-3 max-w-3xl text-slate-300">DealFlowIQ alerts stay inside the app for now: imports, buyer matches, review issues, Buy Box runs and opportunity changes.</p>
            </div>
            <form action={markAllNotificationsReadAction}>
              <button className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-200">Mark all read</button>
            </form>
          </div>
          {error ? <div className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">{error.message}</div> : null}
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"><div className="text-sm text-slate-400">Unread</div><div className="mt-2 text-3xl font-black">{unread}</div></div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"><div className="text-sm text-slate-400">Total</div><div className="mt-2 text-3xl font-black">{rows.length}</div></div>
          <Link href="/imports" className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition hover:bg-white/[0.06]"><div className="text-sm text-slate-400">Import queue</div><div className="mt-2 text-lg font-bold">Open imports →</div></Link>
        </section>

        <section className="space-y-3">
          {rows.map((item) => (
            <article key={item.id} className={`rounded-2xl border p-5 ${item.read_at ? 'border-white/10 bg-white/[0.03]' : 'border-emerald-400/30 bg-emerald-400/[0.08]'}`}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-bold text-white">{item.title}</h2>
                    {!item.read_at ? <span className="rounded-full bg-emerald-400 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-slate-950">Unread</span> : null}
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">{String(item.type).replaceAll('_', ' ')}</span>
                  </div>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{item.message}</p>
                  <div className="mt-2 text-xs text-slate-500">{dateText(item.created_at)}</div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {item.action_href ? <Link href={String(item.action_href)} className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-white/10">Open</Link> : null}
                  {!item.read_at ? (
                    <form action={markNotificationReadAction}>
                      <input type="hidden" name="notification_id" value={item.id} />
                      <input type="hidden" name="return_to" value="/notifications" />
                      <button className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-slate-200">Mark read</button>
                    </form>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
          {!rows.length ? <div className="rounded-3xl border border-dashed border-white/15 bg-white/[0.03] p-10 text-center"><h2 className="text-xl font-bold">No notifications yet</h2><p className="mt-2 text-slate-400">Run an import, create buyer matches or save deals to start seeing activity here.</p><Link href="/imports" className="mt-5 inline-flex rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950">Open Import Queue</Link></div> : null}
        </section>
      </div>
    </AppShell>
  )
}
