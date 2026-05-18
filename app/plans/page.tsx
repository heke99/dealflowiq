import Link from 'next/link'
import { CheckCircle2, Sparkles, Users, Zap } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/session'
import { PublicFooter } from '@/components/layout/PublicFooter'

const fallbackPlans = [
  {
    code: 'free',
    name: 'Free',
    description: 'Browse a small number of opportunities and preview the workflow before upgrading.',
    monthly_price_cents: 0,
    annual_price_cents: 0,
    features: ['2 opportunity listings', '1 opportunity detail every 48h', 'Limited import preview', 'Community deal browsing'],
  },
  {
    code: 'premium',
    name: 'Premium',
    description: 'Full investor toolkit for imports, scoring, calculators, rent intelligence and exports.',
    monthly_price_cents: 1299,
    annual_price_cents: 15000,
    features: ['100 imports/month', 'Unlimited saved deals', 'Deal Score + DSCR', 'BRRRR/Flip/Rental/Wholesale calculators', 'Market rent intelligence', 'Exports and buy-box alerts'],
  },
  {
    code: 'community_owner',
    name: 'Community Owner',
    description: 'Everything in Premium plus community creation, invites, member workflows and analytics.',
    monthly_price_cents: 1999,
    annual_price_cents: 23000,
    features: ['Create/manage community', 'Invite by email or code', 'Member profiles and roles', 'Community dashboard', 'Deal posting analytics', 'Moderation tools'],
  },
]

type Row = Record<string, any>

function money(cents?: number | null) {
  if (!cents) return '$0'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: Number(cents) % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(Number(cents) / 100)
}

function featuresFor(plan: Row) {
  const limits = plan.limits && typeof plan.limits === 'object' ? plan.limits : {}
  if (plan.code === 'free') return fallbackPlans[0].features
  if (plan.code === 'community_owner') return fallbackPlans[2].features
  if (plan.code === 'premium') return fallbackPlans[1].features
  const features = plan.features && typeof plan.features === 'object' ? Object.entries(plan.features).filter(([, enabled]) => enabled).map(([key]) => key.replaceAll('_', ' ')) : []
  const limitText = limits.max_imports_per_month ? [`${limits.max_imports_per_month} imports/month`] : []
  return [...limitText, ...features].slice(0, 6)
}

async function loadPlans() {
  try {
    const supabase = await createSupabaseServerClient()
    const { data } = await supabase
      .from('billing_plans')
      .select('id, code, name, description, monthly_price_cents, annual_price_cents, currency, features, limits, display_order')
      .eq('is_public', true)
      .eq('is_active', true)
      .in('code', ['free', 'premium', 'community_owner'])
      .order('display_order', { ascending: true })
    return data?.length ? data as Row[] : fallbackPlans as Row[]
  } catch {
    return fallbackPlans as Row[]
  }
}

export default async function PlansPage() {
  const [plans, user] = await Promise.all([loadPlans(), getCurrentUser()])
  const ctaHref = user ? '/settings/billing' : '/signup'

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
        <Link href="/" className="text-2xl font-bold tracking-tight">DealFlowIQ</Link>
        <nav className="flex items-center gap-3 text-sm">
          <Link href={user ? '/dashboard' : '/login'} className="rounded-xl border border-white/10 px-4 py-2 font-semibold text-slate-100 hover:bg-white/10">{user ? 'Dashboard' : 'Log in'}</Link>
          <Link href={ctaHref} className="rounded-xl bg-white px-4 py-2 font-semibold text-slate-950 hover:bg-slate-200">{user ? 'Manage billing' : 'Get started'}</Link>
        </nav>
      </header>

      <section className="mx-auto max-w-7xl px-6 pb-20 pt-10">
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm font-black text-emerald-100">
            <Sparkles className="h-4 w-4" /> Launch pricing
          </div>
          <h1 className="mt-6 text-5xl font-black tracking-tight sm:text-6xl">Start cheap. Upgrade when deal flow gets serious.</h1>
          <p className="mt-5 text-lg leading-8 text-slate-300">Premium unlocks the investor engine. Community Owner adds member invites, community analytics and management tools.</p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {plans.map((plan) => {
            const highlighted = plan.code === 'premium'
            const community = plan.code === 'community_owner'
            return (
              <div key={plan.code} className={`rounded-[2rem] border p-6 ${highlighted ? 'border-emerald-400/30 bg-emerald-400/10 shadow-2xl shadow-emerald-950/30' : 'border-white/10 bg-white/[0.035]'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-black">{plan.name}</h2>
                    <p className="mt-3 min-h-[72px] text-sm leading-6 text-slate-300">{plan.description}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3 text-slate-200">{community ? <Users className="h-5 w-5" /> : highlighted ? <Zap className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}</div>
                </div>

                <div className="mt-6">
                  <div className="text-4xl font-black">{money(plan.monthly_price_cents)}<span className="text-base font-semibold text-slate-400">/month</span></div>
                  <div className="mt-2 text-sm text-slate-400">{money(plan.annual_price_cents)}/year</div>
                </div>

                <ul className="mt-6 space-y-3 text-sm text-slate-200">
                  {featuresFor(plan).map((feature) => (
                    <li key={feature} className="flex gap-3"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-200" /> <span>{feature}</span></li>
                  ))}
                </ul>

                <Link href={ctaHref} className={`mt-7 flex w-full items-center justify-center rounded-xl px-5 py-3 text-sm font-black ${highlighted ? 'bg-white text-slate-950 hover:bg-slate-200' : 'border border-white/10 text-white hover:bg-white/10'}`}>
                  {user ? 'Choose in billing' : plan.code === 'free' ? 'Start free' : 'Start trial'}
                </Link>
              </div>
            )
          })}
        </div>
      </section>

      <PublicFooter />
    </main>
  )
}
