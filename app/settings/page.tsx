import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { getAccountTypeConfig } from '@/lib/product/accountTypes'

export default async function SettingsPage() {
  const workspace = await getCurrentWorkspace()
  const config = getAccountTypeConfig(workspace.access.accountType)

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
      <div className="grid gap-6 lg:grid-cols-[1fr_0.85fr]">
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8">
          <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Workspace Settings</div>
          <h1 className="mt-2 text-3xl font-bold">Settings</h1>
          <p className="mt-3 max-w-2xl text-slate-300">
            Manage your organization profile, plan access, underwriting defaults and workspace controls from one place.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/settings/billing" className="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-200">
              Plan & Billing
            </Link>
            {workspace.access.isPlatformAdmin ? (
              <Link href="/admin/plans" className="rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-slate-100 hover:bg-white/10">
                Admin Plans
              </Link>
            ) : null}
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-xl font-bold">Workspace profile</h2>
          <dl className="mt-5 space-y-4 text-sm">
            <div className="flex justify-between gap-4 border-b border-white/10 pb-3">
              <dt className="text-slate-400">Organization</dt>
              <dd className="font-medium">{workspace.organization?.name}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-white/10 pb-3">
              <dt className="text-slate-400">Account type</dt>
              <dd className="font-medium">{config.title}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-400">Role</dt>
              <dd className="font-medium capitalize">{workspace.membership?.role?.replaceAll('_', ' ')}</dd>
            </div>
          </dl>
        </div>
      </div>
    </AppShell>
  )
}
