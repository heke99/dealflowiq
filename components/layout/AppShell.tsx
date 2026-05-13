import Link from 'next/link'
import { signOutAction } from '@/lib/auth/actions'
import { canUseFeature, type FeatureMap } from '@/lib/billing/features'
import { getAccountTypeConfig } from '@/lib/product/accountTypes'

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
  const nav = [
    { href: '/dashboard', label: 'Dashboard', visible: true },
    { href: '/deals', label: config.primaryNavLabel, visible: canUseFeature(features, 'deals') },
    { href: '/buyers', label: 'Buyers', visible: canUseFeature(features, 'buyers') || canUseFeature(features, 'buyer_matching') },
    { href: '/settings/billing', label: 'Plan & Billing', visible: true },
    { href: '/settings', label: 'Settings', visible: true },
    { href: '/admin/plans', label: 'Admin Plans', visible: Boolean(isPlatformAdmin) },
  ].filter((item) => item.visible)

  const trialDate = formatTrialDate(trialEndsAt)

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-white/10 bg-slate-950/95 p-6 lg:block">
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

        <nav className="mt-8 space-y-1">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-xl px-4 py-3 text-sm font-medium text-slate-300 transition hover:bg-white/10 hover:text-white"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <form action={signOutAction} className="absolute bottom-6 left-6 right-6">
          <button className="w-full rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/10">
            Sign out
          </button>
        </form>
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
            {nav.map((item) => (
              <Link key={item.href} href={item.href} className="rounded-lg bg-white/5 px-3 py-2 text-sm text-slate-300">
                {item.label}
              </Link>
            ))}
          </nav>
        </header>

        <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
