import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { getAccountTypeConfig } from '@/lib/product/accountTypes'
import { canUseFeature } from '@/lib/billing/features'

export default async function DealsPage() {
  const workspace = await getCurrentWorkspace()
  const config = getAccountTypeConfig(workspace.access.accountType)
  const isEnabled = canUseFeature(workspace.access.features, 'deals')

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
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8">
        <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Batch 3 next</div>
        <h1 className="mt-2 text-3xl font-bold">{config.primaryNavLabel}</h1>
        {isEnabled ? (
          <p className="mt-3 max-w-2xl text-slate-300">
            Your plan currently allows this module. Next we will add manual deal creation, property fields, rent assumptions and the deal status pipeline.
          </p>
        ) : (
          <div className="mt-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-100">
            This module is locked for the current account type or plan. Platform admin can enable it through plan features or subscription overrides.
          </div>
        )}
      </div>
    </AppShell>
  )
}
