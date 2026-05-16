import Link from 'next/link'
import { signOutAction } from '@/lib/auth/actions'
import type { FeatureMap, FeatureKey } from '@/lib/billing/features'
import { canUseFeature, featureLabels } from '@/lib/billing/features'
import { getAccountTypeConfig } from '@/lib/product/accountTypes'

type NavItem = {
  href: string
  label: string
  visible: boolean
  feature?: FeatureKey
  core?: boolean
}

type AppShellProps = {
  children: React.ReactNode
  organizationName?: string | null
  userEmail?: string | null
  accountType?: string | null
  features?: FeatureMap | null
  subscriptionStatus?: string | null
  planName?: string | null
  trialEndsAt?: string | null
  isPlatformAdmin?: boolean
}

function formatTrialDate(value?: string | null) {
  if (!value) return null
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
}

function LockedPill({ feature }: { feature: FeatureKey }) {
  return (
    <span title={`${featureLabels[feature]} is available on higher plans or admin override.`} className="rounded-full border border-amber-400/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
      Upgrade
    </span>
  )
}

export function AppShell({
  children,
  organizationName,
  userEmail,
  accountType,
  features,
  subscriptionStatus,
  planName,
  trialEndsAt,
  isPlatformAdmin,
}: AppShellProps) {
  const config = getAccountTypeConfig(accountType)
  const rawNav: NavItem[] = [
    { href: '/dashboard', label: 'Dashboard', visible: true, core: true },
    { href: '/community', label: 'Community', visible: true, core: true },
    { href: '/market', label: 'Market', visible: true, feature: 'market_opportunities', core: true },
    { href: '/opportunities', label: 'Opportunities', visible: true, feature: 'market_opportunities', core: true },
    { href: '/buy-boxes', label: 'Buy Boxes', visible: true, feature: 'scheduled_market_imports' },
    { href: '/saved-deals', label: 'Saved Deals', visible: true, feature: 'market_opportunities', core: true },
    { href: '/deals', label: 'My Deals', visible: true, feature: 'deals', core: true },
    { href: '/market-search', label: 'Source Imports', visible: true, feature: 'market_source_imports' },
    { href: '/rent-analysis', label: 'Rent Analysis', visible: true, feature: 'rent_analysis', core: true },
    { href: '/calculators', label: 'Calculators', visible: true, feature: 'calculators', core: true },
    { href: '/buyers', label: 'Buyers', visible: true, feature: 'buyers' },
    { href: '/settings/billing', label: 'Plan & Billing', visible: true, core: true },
    { href: '/settings/underwriting', label: 'Underwriting Defaults', visible: true, core: true },
    { href: '/settings', label: 'Settings', visible: true, core: true },
    { href: '/admin/plans', label: 'Admin Plans', visible: Boolean(isPlatformAdmin), feature: 'admin_plan_management' },
    { href: '/admin/access', label: 'Admin Access', visible: Boolean(isPlatformAdmin), feature: 'admin_plan_management' },
  ]
  const nav = rawNav.filter((item) => item.visible)

  const trialDate = formatTrialDate(trialEndsAt)

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-white/10 bg-slate-950/95 p-6 lg:flex lg:flex-col">
        <Link href="/dashboard" className="block">
          <div className="text-2xl font-bold tracking-tight">DealFlowIQ</div>
          <div className="mt-1 text-sm text-slate-400">Real estate underwriting OS</div>
        </Link>

        <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Workspace</div>
          <div className="mt-1 truncate font-semibold">{organizationName || 'Organization'}</div>
          <div className="mt-1 truncate text-sm text-slate-400">{userEmail}</div>
          <div className="mt-4 rounded-xl border border-white/10 bg-slate-900/70 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Account type</div>
            <div className="mt-1 text-sm font-semibold">{config.title}</div>
            <div className="mt-2 text-xs text-slate-500">{planName || 'Plan pending'} · {subscriptionStatus || 'trialing'}</div>
            {trialDate ? <div className="mt-1 text-xs text-emerald-300">Trial ends {trialDate}</div> : null}
          </div>
        </div>

        <nav className="mt-8 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1 pb-4">
          {nav.map((item) => {
            const locked = Boolean(item.feature && !item.core && !canUseFeature(features, item.feature))
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-medium text-slate-300 transition hover:bg-white/10 hover:text-white"
              >
                <span>{item.label}</span>
                {locked && item.feature ? <LockedPill feature={item.feature} /> : null}
              </Link>
            )
          })}
        </nav>

        <div className="mt-4 border-t border-white/10 pt-4">
          <form action={signOutAction}>
            <button className="w-full rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/10">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/90 px-4 py-4 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-4">
            <Link href="/dashboard" className="font-bold">DealFlowIQ</Link>
            <form action={signOutAction}>
              <button className="rounded-lg border border-white/10 px-3 py-2 text-sm">Sign out</button>
            </form>
          </div>
          <nav className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {nav.map((item) => {
              const locked = Boolean(item.feature && !item.core && !canUseFeature(features, item.feature))
              return (
                <Link key={item.href} href={item.href} className="flex shrink-0 items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm text-slate-300">
                  <span>{item.label}</span>
                  {locked ? <span className="text-amber-200">•</span> : null}
                </Link>
              )
            })}
          </nav>
        </header>

        <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
