import Link from 'next/link'
import { signInAction } from '@/lib/auth/actions'

type LoginPageProps = {
  searchParams?: Promise<{ error?: string; message?: string; next?: string }> | { error?: string; message?: string; next?: string }
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await Promise.resolve(searchParams || {})

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12 text-white">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.03] p-8 shadow-2xl">
        <div>
          <Link href="/" className="text-2xl font-bold">DealFlowIQ</Link>
          <h1 className="mt-8 text-3xl font-bold tracking-tight">Log in</h1>
          <p className="mt-2 text-sm text-slate-400">Access your real estate underwriting workspace.</p>
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
              className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none transition focus:border-white/30"
              placeholder="you@example.com"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-300">Password</span>
            <input
              name="password"
              type="password"
              required
              className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none transition focus:border-white/30"
              placeholder="••••••••"
            />
          </label>

          <button className="w-full rounded-xl bg-white px-4 py-3 font-semibold text-slate-950 transition hover:bg-slate-200">
            Log in
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-400">
          No account? <Link href="/signup" className="font-semibold text-white hover:underline">Create one</Link>
        </p>
      </div>
    </main>
  )
}
