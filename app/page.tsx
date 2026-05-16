import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/session'

const metrics = [
  ['10x', 'faster first-pass deal review'],
  ['HUD', 'rent and Section 8 intelligence'],
  ['DSCR', 'bank-view underwriting'],
  ['Teams', 'community and investor workflows'],
]

const features = [
  { title: 'Import and rank deals', text: 'Bring in authorized source URLs, normalize listings, estimate rent, calculate score and move real opportunities forward.' },
  { title: 'Underwrite like an operator', text: 'Track market rent, current rent, expenses, rehab, DSCR, cap rate, cashflow and confidence in one workspace.' },
  { title: 'Build a community engine', text: 'Invite members by email or code, assign them to teams, and keep deal review inside your own branded workflow.' },
]

const audiences = ['Rental investors', 'BRRRR operators', 'Wholesalers', 'Section 8 landlords', 'Acquisition teams', 'Real estate communities']

export default async function HomePage() {
  const user = await getCurrentUser()
  if (user) redirect('/dashboard')

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
        <Link href="/" className="text-2xl font-bold tracking-tight">DealFlowIQ</Link>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/login" className="rounded-xl border border-white/10 px-4 py-2 font-semibold text-slate-100 hover:bg-white/10">Log in</Link>
          <Link href="/signup" className="rounded-xl bg-white px-4 py-2 font-semibold text-slate-950 hover:bg-slate-200">Get started</Link>
        </nav>
      </header>

      <section className="mx-auto grid max-w-7xl gap-10 px-6 pb-20 pt-10 lg:grid-cols-[1.08fr_0.92fr] lg:items-center">
        <div>
          <div className="inline-flex rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm font-medium text-emerald-200">
            Deal sourcing, rent intelligence and buyer matching in one OS
          </div>
          <h1 className="mt-7 max-w-5xl text-5xl font-bold tracking-tight sm:text-7xl">
            Turn raw property links into ranked investment opportunities.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
            DealFlowIQ helps investors and communities import authorized listings, analyze rent upside, calculate DSCR/cap rate/cashflow, and move the best deals into a clean review pipeline.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/signup" className="rounded-xl bg-white px-6 py-3 font-semibold text-slate-950 transition hover:bg-slate-200">Create your workspace</Link>
            <Link href="/signup?account=community_guru_owner" className="rounded-xl border border-white/10 px-6 py-3 font-semibold text-white transition hover:bg-white/10">Launch a community</Link>
          </div>
          <div className="mt-10 flex flex-wrap gap-2">
            {audiences.map((item) => <span key={item} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-slate-300">{item}</span>)}
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/30">
          <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-5">
            <div className="flex items-center justify-between gap-4">
              <div><div className="text-sm text-slate-500">Sample deal score</div><div className="mt-1 text-2xl font-bold">Columbus, OH rental</div></div>
              <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-center text-emerald-100"><div className="text-xs uppercase tracking-wide">Score</div><div className="text-3xl font-bold">89</div></div>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {[
                ['Market rent', '$1,850'], ['Current rent', '$1,425'], ['DSCR', '1.31x'], ['Cap rate', '8.2%'], ['Cashflow', '$421/mo'], ['Confidence', '74/100'],
              ].map(([label, value]) => <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 text-xl font-bold">{value}</div></div>)}
            </div>
            <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-slate-300">
              <span className="font-semibold text-white">Why this deal?</span> Strong rent upside, acceptable DSCR, and enough confidence to move from Market into Opportunities.
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-20">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {metrics.map(([value, label]) => <div key={label} className="rounded-3xl border border-white/10 bg-white/[0.03] p-5"><div className="text-3xl font-bold">{value}</div><div className="mt-2 text-sm text-slate-400">{label}</div></div>)}
        </div>
        <div className="mt-8 grid gap-5 lg:grid-cols-3">
          {features.map((feature) => <div key={feature.title} className="rounded-3xl border border-white/10 bg-white/[0.03] p-6"><h2 className="text-xl font-bold">{feature.title}</h2><p className="mt-3 text-sm leading-6 text-slate-400">{feature.text}</p></div>)}
        </div>
      </section>
    </main>
  )
}
