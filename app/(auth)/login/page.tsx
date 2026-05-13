import Link from 'next/link'
import { signInAction } from '@/lib/auth/actions'

type LoginPageProps = {
  searchParams?: Promise<{ error?: string; message?: string; next?: string }> | { error?: string; message?: string; next?: string }
}

const highlights = [
  'Analyze rent, NOI, cap rate and DSCR.',
  'Compare BRRRR, flip, wholesale and buy & hold.',
  'Prepare buyer-ready deal pages and reports.',
]

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await Promise.resolve(searchParams || {})

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
        <section className="hidden border-r border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.12),transparent_30%)] px-10 py-12 lg:flex lg:flex-col lg:justify-between">
          <Link href="/" className="text-2xl font-bold tracking-tight">DealFlowIQ</Link>

          <div className="max-w-xl">
            <div className="mb-5 inline-flex rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300">
              Real estate underwriting OS
            </div>
            <h1 className="text-5xl font-bold tracking-tight">Log in and keep your deal flow moving.</h1>
            <p className="mt-5 text-lg leading-8 text-slate-300">
              Access your underwriting workspace, rent assumptions, Section 8 scenarios, buyer lists and upcoming projection tools.
            </p>
            <div className="mt-8 grid gap-3">
              {highlights.map((item) => (
                <div key={item} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm text-slate-200">
                  {item}
                </div>
              ))}
            </div>
          </div>

          <p className="text-sm text-slate-500">Built for investors, wholesalers, landlords and real estate communities.</p>
        </section>

        <section className="flex items-center justify-center px-4 py-12 sm:px-6">
          <div className="w-full max-w-md">
            <div className="mb-8 lg:hidden">
              <Link href="/" className="text-2xl font-bold">DealFlowIQ</Link>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl shadow-black/30 sm:p-8">
              <div>
                <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Welcome back</div>
                <h1 className="mt-2 text-3xl font-bold tracking-tight">Log in to your account</h1>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Continue building your DealFlowIQ workspace.
                </p>
              </div>

              {params.error ? (
                <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                  {decodeURIComponent(params.error)}
                </div>
              ) : null}

              {params.message ? (
                <div className="mt-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                  {decodeURIComponent(params.message)}
                </div>
              ) : null}

              <form action={signInAction} className="mt-8 space-y-5">
                <input type="hidden" name="next" value={params.next || '/dashboard'} />

                <label className="block">
                  <span className="text-sm font-medium text-slate-300">Email</span>
                  <input
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none transition placeholder:text-slate-600 focus:border-white/30 focus:ring-4 focus:ring-white/5"
                    placeholder="you@example.com"
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-slate-300">Password</span>
                  <input
                    name="password"
                    type="password"
                    required
                    autoComplete="current-password"
                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none transition placeholder:text-slate-600 focus:border-white/30 focus:ring-4 focus:ring-white/5"
                    placeholder="Enter your password"
                  />
                </label>

                <button className="w-full rounded-xl bg-white px-4 py-3 font-semibold text-slate-950 transition hover:bg-slate-200">
                  Log in
                </button>
              </form>

              <p className="mt-6 text-center text-sm text-slate-400">
                No account yet?{' '}
                <Link href="/signup" className="font-semibold text-white hover:underline">
                  Create one now
                </Link>
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
