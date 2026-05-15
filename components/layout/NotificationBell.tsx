import Link from 'next/link'
import { Bell } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { markNotificationReadAction } from '@/app/notifications/actions'

type Row = Record<string, any>

function dateText(value?: string | null) {
  if (!value) return ''
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

export async function NotificationBell() {
  let notifications: Row[] = []
  let unread = 0

  try {
    const workspace = await getCurrentWorkspace()
    if (workspace.organization?.id) {
      const supabase = await createSupabaseServerClient()
      const [{ data }, { count }] = await Promise.all([
        supabase
          .from('notifications')
          .select('*')
          .eq('organization_id', workspace.organization.id)
          .or(`user_id.is.null,user_id.eq.${workspace.user.id}`)
          .is('archived_at', null)
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', workspace.organization.id)
          .or(`user_id.is.null,user_id.eq.${workspace.user.id}`)
          .is('read_at', null)
          .is('archived_at', null),
      ])
      notifications = (data || []) as Row[]
      unread = count || 0
    }
  } catch {
    notifications = []
    unread = 0
  }

  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10">
        <span className="relative inline-flex">
          <Bell className="h-4 w-4" />
          {unread ? <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-400 px-1 text-[10px] font-black text-slate-950">{unread > 9 ? '9+' : unread}</span> : null}
        </span>
        <span className="hidden sm:inline">Notifications</span>
      </summary>
      <div className="absolute right-0 z-40 mt-3 w-80 overflow-hidden rounded-2xl border border-white/10 bg-slate-950 shadow-2xl shadow-black/50">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 p-4">
          <div>
            <div className="font-bold text-white">Notifications</div>
            <div className="text-xs text-slate-500">{unread} unread</div>
          </div>
          <Link href="/notifications" className="text-xs font-semibold text-slate-300 hover:text-white">View all</Link>
        </div>
        <div className="max-h-96 overflow-y-auto p-2">
          {notifications.length ? notifications.map((item) => (
            <div key={item.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="line-clamp-1 text-sm font-semibold text-white">{item.title}</div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">{item.message}</p>
                  <div className="mt-2 text-[11px] text-slate-600">{dateText(item.created_at)}</div>
                </div>
                {!item.read_at ? <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-400" /> : null}
              </div>
              <div className="mt-3 flex items-center gap-2">
                {item.action_href ? <Link href={String(item.action_href)} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10">Open</Link> : null}
                {!item.read_at ? (
                  <form action={markNotificationReadAction}>
                    <input type="hidden" name="notification_id" value={item.id} />
                    <input type="hidden" name="return_to" value="/dashboard" />
                    <button className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-400 hover:bg-white/10 hover:text-white">Read</button>
                  </form>
                ) : null}
              </div>
            </div>
          )) : <div className="p-6 text-center text-sm text-slate-500">No notifications yet.</div>}
        </div>
      </div>
    </details>
  )
}
