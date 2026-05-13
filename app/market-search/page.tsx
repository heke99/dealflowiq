import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'

export default async function MarketSearchPage() {
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
          <h1 className="mt-2 text-3xl font-bold">Market Search</h1>
          <p className="mt-3 max-w-3xl text-slate-300">
            Every account type can search and study markets. This foundation will later connect rent comps, HUD/FMR data, saved markets and licensed market APIs.
          </p>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-xl font-bold">Search setup</h2>
            <div className="mt-5 grid gap-4">
              <input placeholder="City, state or ZIP code" className="rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 outline-none placeholder:text-slate-600 focus:border-white/30" />
              <select className="rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 outline-none focus:border-white/30" defaultValue="rental">
                <option value="rental">Rental market</option>
                <option value="section8">Section 8 / HUD market</option>
                <option value="wholesale">Wholesale market</option>
                <option value="flip">Fix & flip market</option>
              </select>
              <button className="rounded-xl bg-white px-5 py-3 font-semibold text-slate-950 opacity-70" disabled>Search market — coming next</button>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-xl font-bold">What this will power</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {['Market rent ranges', 'Comparable rents', 'Rent per sqft', 'HUD/FMR benchmarks', 'Saved markets', 'Deal opportunity score'].map((item) => (
                <div key={item} className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 text-sm text-slate-300">{item}</div>
              ))}
            </div>
            <p className="mt-5 text-sm text-slate-500">
              MVP starts with manual comps. Later this can connect to RentCast, ATTOM, PropStream, BatchData, Estated, HouseCanary or licensed data providers.
            </p>
          </div>
        </section>

        <Link href="/deals/new" className="inline-flex rounded-xl border border-white/10 px-5 py-3 font-semibold text-slate-100 transition hover:bg-white/10">
          Create a deal from market research
        </Link>
      </div>
    </AppShell>
  )
}
