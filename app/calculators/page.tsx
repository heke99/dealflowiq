import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { canUseFeature } from '@/lib/billing/features'

export default async function CalculatorsPage() {
  const workspace = await getCurrentWorkspace()
  const premium = [
    ['BRRRR Calculator', 'brrrr', 'Buy, rehab, rent, refinance and repeat.'],
    ['Fix & Flip Calculator', 'flip', 'ARV minus costs equals projected profit.'],
    ['Wholesale Calculator', 'wholesale', 'MAO, buyer max price and assignment spread.'],
    ['5-Year Projection', 'five_year_projection', 'NOI growth, DSCR, loan balance and equity.'],
  ] as const

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
          <h1 className="mt-2 text-3xl font-bold">Calculators</h1>
          <p className="mt-3 max-w-3xl text-slate-300">
            Basic calculators are visible to every account type. Subscription plans unlock deeper calculators, exports and projections.
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          {[
            ['NOI', 'Effective gross income minus operating expenses.'],
            ['Cap Rate', 'NOI divided by purchase price.'],
            ['DSCR', 'NOI divided by annual debt service.'],
            ['Cashflow', 'NOI minus debt service.'],
          ].map(([title, text]) => (
            <div key={title} className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <div className="text-xl font-bold">{title}</div>
              <p className="mt-2 text-sm text-slate-400">{text}</p>
            </div>
          ))}
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-xl font-bold">Premium calculators</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {premium.map(([title, feature, text]) => {
              const enabled = canUseFeature(workspace.access.features, feature)
              return (
                <div key={feature} className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-bold">{title}</h3>
                    <span className={enabled ? 'rounded-full bg-emerald-400/10 px-2 py-1 text-xs font-semibold text-emerald-200' : 'rounded-full bg-amber-400/10 px-2 py-1 text-xs font-semibold text-amber-200'}>
                      {enabled ? 'Enabled' : 'Upgrade'}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-400">{text}</p>
                </div>
              )
            })}
          </div>
        </section>

        <Link href="/deals" className="inline-flex rounded-xl border border-white/10 px-5 py-3 font-semibold text-slate-100 transition hover:bg-white/10">
          Open saved deals
        </Link>
      </div>
    </AppShell>
  )
}
