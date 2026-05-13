import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'

export default async function RentAnalysisPage() {
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
          <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Universal Core Module</div>
          <h1 className="mt-2 text-3xl font-bold">Rent Analysis</h1>
          <p className="mt-3 max-w-3xl text-slate-300">
            Rent analysis is available to every account type. The next batches will calculate current rent vs market rent, HUD rent and target rent from saved deal data.
          </p>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ['Current Rent', 'User-entered rent today'],
            ['Market Rent', 'Manual comps first, APIs later'],
            ['HUD / Section 8', 'Plan-gated benchmark module'],
            ['Annual Upside', 'Monthly rent gap × 12'],
          ].map(([title, text]) => (
            <div key={title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <div className="text-lg font-bold">{title}</div>
              <p className="mt-2 text-sm text-slate-400">{text}</p>
            </div>
          ))}
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-xl font-bold">Rent gap formula</h2>
          <div className="mt-4 rounded-2xl border border-white/10 bg-slate-900/70 p-5 font-mono text-sm text-slate-300">
            Market Rent - Current Rent = Monthly Rent Gap<br />
            HUD Rent - Current Rent = Section 8 Monthly Upside<br />
            Monthly Upside × 12 = Annual Rent Upside
          </div>
          <Link href="/deals/new" className="mt-5 inline-flex rounded-xl bg-white px-5 py-3 font-semibold text-slate-950 transition hover:bg-slate-200">
            Add rent assumptions to a deal
          </Link>
        </section>
      </div>
    </AppShell>
  )
}
