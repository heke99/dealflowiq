import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/session'

export default async function HomePage() {
  const user = await getCurrentUser()
  if (user) redirect('/dashboard')

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-6 py-20">
        <div className="max-w-3xl">
          <div className="mb-6 inline-flex rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300">
            Real estate deal analysis, rent intelligence and buyer matching
          </div>
          <h1 className="text-5xl font-bold tracking-tight sm:text-7xl">DealFlowIQ</h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
            Underwrite rental, Section 8, BRRRR, flip and wholesale deals with clean assumptions,
            financial metrics and buyer-ready outputs.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link href="/signup" className="rounded-xl bg-white px-5 py-3 font-semibold text-slate-950 transition hover:bg-slate-200">
              Create account
            </Link>
            <Link href="/login" className="rounded-xl border border-white/10 px-5 py-3 font-semibold text-white transition hover:bg-white/10">
              Log in
            </Link>
          </div>
        </div>
      </section>
    </main>
  )
}
