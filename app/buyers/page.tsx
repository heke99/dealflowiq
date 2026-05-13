import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { canUseFeature } from '@/lib/billing/features'

export default async function BuyersPage() {
  const workspace = await getCurrentWorkspace()
  const isEnabled = canUseFeature(workspace.access.features, 'buyers') || canUseFeature(workspace.access.features, 'buyer_matching')

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
        <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Buyer module</div>
        <h1 className="mt-2 text-3xl font-bold">Buyers</h1>
        {isEnabled ? (
          <p className="mt-3 max-w-2xl text-slate-300">
            Buyer CRM, buy boxes, buyer matching and buyer demand scoring are enabled for this workspace. The actual buyer tables/UI come in a later batch.
          </p>
        ) : (
          <div className="mt-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-100">
            Buyers are visible to every workspace as a preview. Saving buyers, buy boxes and buyer matching are unlocked by plan or admin override.
          </div>
        )}
      </div>
    </AppShell>
  )
}
