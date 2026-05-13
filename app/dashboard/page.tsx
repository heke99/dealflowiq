import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'

const stats = [
  { label: 'Total Deals', value: '0', hint: 'Batch 2 adds deal creation' },
  { label: 'Average Cap Rate', value: '—', hint: 'Batch 3 adds calculations' },
  { label: 'Average DSCR', value: '—', hint: 'Batch 3 adds lender metrics' },
  { label: 'Matched Buyers', value: '0', hint: 'Batch 7 adds buyer matching' },
]

const nextBatches = [
  'Batch 2: Deals table, create deal form, deal list and detail page.',
  'Batch 3: Mortgage, NOI, cap rate, DSCR, cashflow and per-unit calculations.',
  'Batch 4: Rent intelligence structure and Section 8/HUD assumptions.',
  'Batch 5: BRRRR, flip, wholesale and strategy comparison.',
]

export default async function DashboardPage() {
  const workspace = await getCurrentWorkspace()

  return (
    <AppShell organizationName={workspace.organization?.name} userEmail={workspace.user.email}>
      <div className="flex flex-col gap-8">
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Batch 1 Foundation</div>
              <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Welcome to DealFlowIQ</h1>
              <p className="mt-3 max-w-3xl text-slate-300">
                Your SaaS foundation is now ready: authentication, organizations, member roles, protected routes and a clean app shell.
              </p>
              {workspace.error ? (
                <div className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
                  Supabase setup issue: {workspace.error}
                </div>
              ) : null}
            </div>
            <Link href="/deals" className="rounded-xl bg-white px-5 py-3 text-center font-semibold text-slate-950 transition hover:bg-slate-200">
              Go to Deals
            </Link>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map((item) => (
            <div key={item.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <div className="text-sm text-slate-400">{item.label}</div>
              <div className="mt-3 text-3xl font-bold">{item.value}</div>
              <div className="mt-3 text-xs text-slate-500">{item.hint}</div>
            </div>
          ))}
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-xl font-bold">Workspace</h2>
            <dl className="mt-5 space-y-4 text-sm">
              <div className="flex justify-between gap-4 border-b border-white/10 pb-3">
                <dt className="text-slate-400">Organization</dt>
                <dd className="font-medium">{workspace.organization?.name || 'Not created'}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-white/10 pb-3">
                <dt className="text-slate-400">Your role</dt>
                <dd className="font-medium capitalize">{workspace.membership?.role?.replaceAll('_', ' ') || '—'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-400">Email</dt>
                <dd className="font-medium">{workspace.user.email}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-xl font-bold">Next build steps</h2>
            <ul className="mt-5 space-y-3 text-sm text-slate-300">
              {nextBatches.map((item) => (
                <li key={item} className="rounded-xl border border-white/10 bg-slate-900/60 p-3">{item}</li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </AppShell>
  )
}
