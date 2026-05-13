import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'

export default async function DealsPage() {
  const workspace = await getCurrentWorkspace()

  return (
    <AppShell organizationName={workspace.organization?.name} userEmail={workspace.user.email}>
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8">
        <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Batch 2</div>
        <h1 className="mt-2 text-3xl font-bold">Deals</h1>
        <p className="mt-3 max-w-2xl text-slate-300">
          This page is ready for the next batch: manual deal creation, deal list, property fields, rent assumptions and deal status pipeline.
        </p>
      </div>
    </AppShell>
  )
}
