import Link from 'next/link'
import { signUpAction } from '@/lib/auth/actions'

type SignupPageProps = {
  searchParams?: Promise<{ error?: string }> | { error?: string }
}

const accountTypes = [
  {
    value: 'solo_investor',
    title: 'Solo Investor',
    description: 'Analyze your own rental, flip, BRRRR and wholesale deals.',
  },
  {
    value: 'wholesaler',
    title: 'Wholesaler',
    description: 'Underwrite deals and prepare them for buyer distribution.',
  },
  {
    value: 'landlord',
    title: 'Landlord',
    description: 'Compare current rent against market rent and cashflow.',
  },
  {
    value: 'section_8_landlord',
    title: 'Section 8 Landlord',
    description: 'Focus on HUD rent, Section 8 upside and inspection readiness.',
  },
  {
    value: 'brrrr_investor',
    title: 'BRRRR Investor',
    description: 'Model rehab, refinance, cash left in deal and cashflow after refi.',
  },
  {
    value: 'fix_and_flip_investor',
    title: 'Fix & Flip Investor',
    description: 'Analyze ARV, rehab, holding costs, selling costs and profit margins.',
  },
  {
    value: 'community_guru_owner',
    title: 'Community / Guru Owner',
    description: 'Create a workspace where members can submit deals for review.',
  },
  {
    value: 'team_company',
    title: 'Team / Company',
    description: 'Run acquisitions, disposition, buyers and deal analysis as a team.',
  },
]

const benefits = [
  'Build a clean underwriting workspace from day one.',
  'Choose the account type that matches your business model.',
  'Community and team accounts are ready for member workflows later.',
]

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const params = await Promise.resolve(searchParams || {})

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto grid min-h-screen max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[0.85fr_1.15fr] lg:px-8 lg:py-12">
        <section className="flex flex-col justify-between rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.20),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.14),transparent_30%)] p-6 sm:p-8">
          <div>
            <Link href="/" className="text-2xl font-bold tracking-tight">DealFlowIQ</Link>
            <div className="mt-10 inline-flex rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300">
              Version 1 foundation
            </div>
            <h1 className="mt-5 text-4xl font-bold tracking-tight sm:text-5xl">
              Create your real estate underwriting workspace.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-8 text-slate-300">
              Start with the right setup: solo investor, wholesaler, landlord, Section 8 operator, BRRRR investor, flip investor, community owner or team.
            </p>
          </div>

          <div className="mt-10 space-y-3">
            {benefits.map((item) => (
              <div key={item} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm text-slate-200">
                {item}
              </div>
            ))}
          </div>
        </section>

        <section className="flex items-center">
          <div className="w-full rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/30 sm:p-8">
            <div>
              <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Create account</div>
              <h2 className="mt-2 text-3xl font-bold tracking-tight">Tell us how you will use DealFlowIQ</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                This sets up your first workspace correctly. You can still change and expand it later.
              </p>
            </div>

            {params.error ? (
              <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                {decodeURIComponent(params.error)}
              </div>
            ) : null}

            <form action={signUpAction} className="mt-8 space-y-7">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-slate-300">Full name</span>
                  <input
                    name="full_name"
                    type="text"
                    autoComplete="name"
                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none transition placeholder:text-slate-600 focus:border-white/30 focus:ring-4 focus:ring-white/5"
                    placeholder="Your name"
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-slate-300">Workspace / company name</span>
                  <input
                    name="organization_name"
                    type="text"
                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none transition placeholder:text-slate-600 focus:border-white/30 focus:ring-4 focus:ring-white/5"
                    placeholder="Optional for solo accounts"
                  />
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
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
                    minLength={6}
                    autoComplete="new-password"
                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none transition placeholder:text-slate-600 focus:border-white/30 focus:ring-4 focus:ring-white/5"
                    placeholder="At least 6 characters"
                  />
                </label>
              </div>

              <fieldset>
                <legend className="text-sm font-semibold text-slate-200">Account type</legend>
                <p className="mt-1 text-sm text-slate-500">Choose the closest fit. This controls the first workspace setup.</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {accountTypes.map((item, index) => (
                    <label key={item.value} className="group relative cursor-pointer rounded-2xl border border-white/10 bg-slate-900/70 p-4 transition hover:border-white/25 hover:bg-slate-900">
                      <input
                        type="radio"
                        name="account_type"
                        value={item.value}
                        defaultChecked={index === 0}
                        className="peer sr-only"
                      />
                      <span className="absolute right-4 top-4 h-4 w-4 rounded-full border border-slate-600 peer-checked:border-white peer-checked:bg-white" />
                      <span className="block pr-8 font-semibold text-white">{item.title}</span>
                      <span className="mt-2 block text-sm leading-6 text-slate-400 peer-checked:text-slate-300">{item.description}</span>
                      <span className="pointer-events-none absolute inset-0 rounded-2xl ring-0 ring-white/0 transition peer-checked:ring-2 peer-checked:ring-white/70" />
                    </label>
                  ))}
                </div>
              </fieldset>

              <button className="w-full rounded-xl bg-white px-4 py-3 font-semibold text-slate-950 transition hover:bg-slate-200">
                Create DealFlowIQ account
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-slate-400">
              Already have an account?{' '}
              <Link href="/login" className="font-semibold text-white hover:underline">
                Log in
              </Link>
            </p>
          </div>
        </section>
      </div>
    </main>
  )
}
