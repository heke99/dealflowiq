import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'

export default async function BuyersPage() {
  const workspace = await getCurrentWorkspace()

  return (
    <AppShell organizationName={workspace.organization?.name} userEmail={workspace.user.email}>
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8">
        <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Batch 7</div>
        <h1 className="mt-2 text-3xl font-bold">Buyers</h1>
        <p className="mt-3 max-w-2xl text-slate-300">
          This page is reserved for buyer CRM, buy boxes, buyer matching and buyer demand scoring.
        </p>
      </div>
    </AppShell>
  )
}
