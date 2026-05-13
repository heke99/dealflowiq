import { AppShell } from '@/components/layout/AppShell'
import { DealForm } from '@/components/deals/DealForm'
import { createDealAction } from '@/app/deals/actions'
import { getCurrentWorkspace } from '@/lib/auth/workspace'

export default async function NewDealPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const workspace = await getCurrentWorkspace()

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
          <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Create Deal</div>
          <h1 className="mt-2 text-3xl font-bold">New deal</h1>
          <p className="mt-3 max-w-3xl text-slate-300">
            Enter the core property, rent, purchase and expense assumptions. These fields become the base for Batch 4 calculations.
          </p>
        </section>
        <DealForm action={createDealAction} submitLabel="Create Deal" error={params?.error ? String(params.error) : null} />
      </div>
    </AppShell>
  )
}
