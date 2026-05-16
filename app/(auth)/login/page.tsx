import Link from 'next/link'
import { ArrowRight, BadgeCheck, BarChart3, Building2, LockKeyhole, Search, ShieldCheck, Target } from 'lucide-react'
import { signInAction } from '@/lib/auth/actions'

type LoginPageProps = {
  searchParams?: Promise<{ error?: string; message?: string; next?: string }> | { error?: string; message?: string; next?: string }
}

const highlights = [
  { icon: Search, title: 'Source', text: 'Import authorized deal links and normalize the important numbers.' },
  { icon: BarChart3, title: 'Underwrite', text: 'Compare rent, NOI, cap rate, cashflow and DSCR in one place.' },
  { icon: Target, title: 'Act', text: 'Move qualified deals into Opportunities and buyer workflows.' },
]

const proof = ['No spreadsheet chaos', 'HUD + rent intelligence', 'Buyer-ready workflow']

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await Promise.resolve(searchParams || {})

  return (
    <main className="min-h-screen overflow-hidden bg-slate-950 text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.24),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.18),transparent_32%)]" />
      <div className="relative grid min-h-screen lg:grid-cols-[1.08fr_0.92fr]">
        <section className="hidden border-r border-white/10 px-10 py-10 lg:flex lg:flex-col lg:justify-between">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-lg font-black text-slate-950">DF</span>
            <span>
              <span className="block text-2xl font-black tracking-tight">DealFlowIQ</span>
              <span className="block text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Investor OS</span>
            </span>
          </Link>

          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm font-bold text-emerald-100">
              <ShieldCheck className="h-4 w-4" />
              Built for serious deal operators
            </div>
            <h1 className="mt-6 text-6xl font-black tracking-tight xl:text-7xl">One clean command center for your real estate pipeline.</h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">
              Log in to review market listings, rank opportunities, update underwriting assumptions, manage buyer matching and keep your community workflow organized.
            </p>

            <div className="mt-8 grid gap-4 xl:grid-cols-3">
              {highlights.map((item) => {
                const Icon = item.icon
                return (
                  <div key={item.title} className="rounded-3xl border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/10">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-slate-950/60 text-emerald-100"><Icon className="h-5 w-5" /></div>
                    <h2 className="mt-4 font-black">{item.title}</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{item.text}</p>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {proof.map((item) => (
              <span key={item} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-300">
                <BadgeCheck className="h-4 w-4 text-emerald-200" />
                {item}
              </span>
            ))}
          </div>
        </section>

        <section className="flex items-center justify-center px-4 py-10 sm:px-6">
          <div className="w-full max-w-md">
            <div className="mb-8 lg:hidden">
              <Link href="/" className="flex items-center gap-3 text-2xl font-black"><Building2 className="h-7 w-7" /> DealFlowIQ</Link>
            </div>

            <div className="rounded-[2rem] border border-white/10 bg-white/[0.055] p-6 shadow-2xl shadow-black/40 backdrop-blur sm:p-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-black uppercase tracking-[0.18em] text-slate-500">Secure login</div>
                  <h1 className="mt-2 text-3xl font-black tracking-tight">Welcome back</h1>
                  <p className="mt-2 text-sm leading-6 text-slate-400">Continue to your DealFlowIQ workspace.</p>
                </div>
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-slate-950/70 text-slate-200"><LockKeyhole className="h-5 w-5" /></div>
              </div>

              {params.error ? (
                <div className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm font-medium text-red-100">
                  {decodeURIComponent(params.error)}
                </div>
              ) : null}

              {params.message ? (
                <div className="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm font-medium text-emerald-100">
                  {decodeURIComponent(params.message)}
                </div>
              ) : null}

              <form action={signInAction} className="mt-8 space-y-5">
                <input type="hidden" name="next" value={params.next || '/dashboard'} />

                <label className="block">
                  <span className="text-sm font-bold text-slate-300">Email</span>
                  <input
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-4 text-white outline-none transition placeholder:text-slate-600 focus:border-emerald-300/50 focus:ring-4 focus:ring-emerald-300/10"
                    placeholder="you@example.com"
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-bold text-slate-300">Password</span>
                  <input
                    name="password"
                    type="password"
                    required
                    autoComplete="current-password"
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-4 text-white outline-none transition placeholder:text-slate-600 focus:border-emerald-300/50 focus:ring-4 focus:ring-emerald-300/10"
                    placeholder="Enter your password"
                  />
                </label>

                <button className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-4 font-black text-slate-950 transition hover:bg-slate-200">
                  Log in
                  <ArrowRight className="h-4 w-4" />
                </button>
              </form>

              <div className="mt-6 rounded-2xl border border-white/10 bg-slate-950/50 p-4 text-sm text-slate-400">
                New to DealFlowIQ?{' '}
                <Link href="/signup" className="font-black text-white hover:underline">
                  Create your workspace
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
