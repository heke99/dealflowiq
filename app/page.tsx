import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/session'

const proofPoints = [
  { value: '10/hr', label: 'Authorized provider import guardrail' },
  { value: '70+', label: 'Opportunity score threshold' },
  { value: '15 days', label: 'Provider data retention control' },
]

const workflows = [
  {
    title: 'Import deal flow',
    text: 'Paste authorized Zillow, Redfin, Realtor, Crexi or LoopNet URLs and move listings into a controlled import queue with audit trail and source policy tracking.',
  },
  {
    title: 'Underwrite with confidence',
    text: 'Run rent intelligence, HUD/FMR checks, cap rate, DSCR, cashflow, BRRRR, flip and buy-and-hold assumptions from one workspace.',
  },
  {
    title: 'Prioritize what matters',
    text: 'Turn raw listings into Market, Watchlist, Needs Review, Opportunity and Strong Opportunity views so your team focuses on the right deals first.',
  },
]

const personas = [
  'Solo investors',
  'Wholesalers',
  'BRRRR investors',
  'Fix & flip operators',
  'Section 8 landlords',
  'Acquisition teams',
  'Buyer communities',
  'Real estate educators',
]

const featureGroups = [
  ['Market Intelligence', 'Provider imports, source policies, retention controls, URL preview and listing dedupe.'],
  ['Rent Intelligence', 'Market rent, current rent, HUD/FMR rent snapshots, confidence breakdown and manual overrides.'],
  ['Investor Metrics', 'NOI, cashflow, cap rate, DSCR, loan assumptions, rehab, ARV and break-even rent.'],
  ['Deal Workflow', 'Stages, notes, activity timeline, in-app notifications, watchlist and opportunities.'],
]

export default async function HomePage() {
  const user = await getCurrentUser()
  if (user) redirect('/dashboard')

  return (
    <main className="min-h-screen overflow-hidden bg-slate-950 text-white">
      <header className="relative z-10 border-b border-white/10 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-5 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-sm font-black text-slate-950">DF</span>
            <span>
              <span className="block text-lg font-black tracking-tight">DealFlowIQ</span>
              <span className="block text-xs text-slate-500">Real estate deal intelligence</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-slate-300 md:flex">
            <a href="#platform" className="hover:text-white">Platform</a>
            <a href="#workflow" className="hover:text-white">Workflow</a>
            <a href="#use-cases" className="hover:text-white">Use cases</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link href="/login" className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10">Log in</Link>
            <Link href="/signup" className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-950 hover:bg-slate-200">Start free</Link>
          </div>
        </div>
      </header>

      <section className="relative">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.24),transparent_32%),radial-gradient(circle_at_70%_20%,rgba(59,130,246,0.18),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(168,85,247,0.18),transparent_28%)]" />
        <div className="relative mx-auto grid min-h-[760px] max-w-7xl items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:py-28">
          <div>
            <div className="inline-flex rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-100">
              Import, underwrite and rank real estate deals before your competitors do.
            </div>
            <h1 className="mt-7 max-w-5xl text-5xl font-black tracking-tight sm:text-6xl lg:text-7xl">
              Turn scattered listings into investor-ready opportunities.
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-300">
              DealFlowIQ is a modern deal intelligence workspace for investors, wholesalers, landlords and real estate communities. Import authorized source URLs, calculate rent and lender metrics, track every assumption and surface the best deals automatically.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link href="/signup" className="rounded-2xl bg-white px-6 py-4 text-center text-sm font-black text-slate-950 shadow-2xl shadow-white/10 hover:bg-slate-200">
                Create your workspace
              </Link>
              <Link href="/login" className="rounded-2xl border border-white/10 px-6 py-4 text-center text-sm font-bold text-white hover:bg-white/10">
                Log in
              </Link>
            </div>
            <div className="mt-10 grid gap-3 sm:grid-cols-3">
              {proofPoints.map((item) => (
                <div key={item.label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="text-2xl font-black text-white">{item.value}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-400">{item.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-4 shadow-2xl shadow-black/40 backdrop-blur">
            <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/90 p-5">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Deal ranking</div>
                  <div className="mt-1 text-xl font-black">Columbus Opportunity Pipeline</div>
                </div>
                <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-bold text-emerald-100">Live</span>
              </div>
              <div className="mt-5 space-y-3">
                {[
                  ['Strong Opportunity', '89', '$1,875 rent', 'DSCR 1.31'],
                  ['Opportunity', '76', '$1,525 rent', 'Needs tax review'],
                  ['Watchlist', '64', 'HUD found', 'Missing sqft'],
                ].map(([label, score, rent, note]) => (
                  <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="font-bold">{label}</div>
                        <div className="mt-1 text-sm text-slate-400">{rent} · {note}</div>
                      </div>
                      <div className="rounded-2xl bg-white px-4 py-3 text-center text-slate-950">
                        <div className="text-[10px] font-bold uppercase tracking-wide">Score</div>
                        <div className="text-2xl font-black">{score}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm leading-6 text-emerald-100">
                New in-app alert: one imported listing meets your Columbus buy box and qualifies as a Strong Opportunity.
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="platform" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {featureGroups.map(([title, text]) => (
            <div key={title} className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-lg font-black">{title}</h2>
              <p className="mt-3 text-sm leading-6 text-slate-400">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="workflow" className="border-y border-white/10 bg-white/[0.02]">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <div className="text-sm font-bold uppercase tracking-wide text-emerald-300">A cleaner workflow</div>
            <h2 className="mt-3 text-4xl font-black tracking-tight">From URL to underwriting decision in one system.</h2>
          </div>
          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            {workflows.map((item, index) => (
              <div key={item.title} className="rounded-3xl border border-white/10 bg-slate-950 p-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-lg font-black text-slate-950">{index + 1}</div>
                <h3 className="mt-5 text-xl font-black">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-400">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="use-cases" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
          <div>
            <div className="text-sm font-bold uppercase tracking-wide text-slate-500">Built for multiple deal models</div>
            <h2 className="mt-3 text-4xl font-black tracking-tight">One workspace for your acquisition engine.</h2>
            <p className="mt-4 text-slate-400 leading-7">Keep private underwriting private, publish community deals when ready, and give your team a shared operating system for sourcing, review and buyer matching.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {personas.map((item) => (
              <div key={item} className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4 font-semibold text-slate-200">{item}</div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-emerald-400/20 via-slate-900 to-blue-500/10 p-8 text-center sm:p-12">
          <h2 className="text-4xl font-black tracking-tight">Ready to clean up your deal flow?</h2>
          <p className="mx-auto mt-4 max-w-2xl text-slate-300">Start with imports, rent intelligence, scoring and in-app opportunity alerts. Add team, buyers and community workflows as you grow.</p>
          <Link href="/signup" className="mt-8 inline-flex rounded-2xl bg-white px-7 py-4 text-sm font-black text-slate-950 hover:bg-slate-200">Start DealFlowIQ</Link>
        </div>
      </section>
    </main>
  )
}
