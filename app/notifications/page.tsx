import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export default async function NotificationsPage() {
  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()

  const { data: auditLogs } = workspace.organization?.id
    ? await supabase
        .from('audit_logs')
        .select('*')
        .eq('organization_id', workspace.organization.id)
        .order('created_at', { ascending: false })
        .limit(30)
    : { data: [] }

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
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-8">
          <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Activity</div>
          <h1 className="mt-2 text-3xl font-bold">Notifications</h1>
          <p className="mt-3 max-w-3xl text-slate-300">In-app activity for imports, deal updates, scoring and system events. Email and SMS distribution are intentionally not enabled.</p>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-xl font-bold">Recent activity</h2>
          <div className="mt-5 space-y-3">
            {(auditLogs || []).map((item: any) => (
              <div key={item.id} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                <div className="text-sm font-semibold text-slate-100">{String(item.event_type || 'Activity').replaceAll('_', ' ')}</div>
                <div className="mt-1 text-xs text-slate-500">{item.created_at ? new Date(item.created_at).toLocaleString() : '—'}</div>
                {item.metadata ? <pre className="mt-3 max-h-40 overflow-auto rounded-xl bg-black/30 p-3 text-xs text-slate-400">{JSON.stringify(item.metadata, null, 2)}</pre> : null}
              </div>
            ))}
            {!(auditLogs || []).length ? <div className="rounded-2xl border border-dashed border-white/15 p-6 text-sm text-slate-500">No notifications yet.</div> : null}
          </div>
        </section>
      </div>
    </AppShell>
  )
}
