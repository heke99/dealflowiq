import Link from 'next/link'
import { signOutAction } from '@/lib/auth/actions'
import type { FeatureMap, FeatureKey } from '@/lib/billing/features'
import { canUseFeature, featureLabels } from '@/lib/billing/features'
import { getAccountTypeConfig } from '@/lib/product/accountTypes'
import { NotificationBell } from '@/components/layout/NotificationBell'

type NavItem = {
  href: string
  label: string
  section: 'Workspace' | 'Deal Flow' | 'Intelligence' | 'Admin'
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
    <span title={`${featureLabels[feature]} is available on higher plans or admin override.`} className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-200">
      Upgrade
    </span>
  )
}

function PlanBadge({ planName, subscriptionStatus }: { planName?: string | null; subscriptionStatus?: string | null }) {
  return (
    <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-bold text-emerald-100">
      {planName || 'Trial'} · {(subscriptionStatus || 'active').replaceAll('_', ' ')}
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
    { href: '/dashboard', label: 'Dashboard', section: 'Workspace', visible: true, core: true },
    { href: '/community', label: 'Community', section: 'Workspace', visible: Boolean(features?.community_members || features?.public_community_deals || accountType === 'community_guru_owner'), feature: 'community_members' },
    { href: '/market', label: 'Market', section: 'Deal Flow', visible: true, feature: 'market_opportunities', core: true },
    { href: '/opportunities', label: 'Opportunities', section: 'Deal Flow', visible: true, feature: 'market_opportunities', core: true },
    { href: '/market-search', label: 'Source Imports', section: 'Deal Flow', visible: true, feature: 'market_source_imports' },
    { href: '/buy-boxes', label: 'Buy Boxes', section: 'Deal Flow', visible: true, feature: 'scheduled_market_imports' },
    { href: '/saved-deals', label: 'Saved Deals', section: 'Deal Flow', visible: true, feature: 'market_opportunities', core: true },
    { href: '/deals', label: 'My Deals', section: 'Deal Flow', visible: true, feature: 'deals', core: true },
    { href: '/buyers', label: 'Buyers', section: 'Deal Flow', visible: true, feature: 'buyers' },
    { href: '/rent-analysis', label: 'Rent Analysis', section: 'Intelligence', visible: true, feature: 'rent_analysis', core: true },
    { href: '/calculators', label: 'Calculators', section: 'Intelligence', visible: true, feature: 'calculators', core: true },
    { href: '/settings/billing', label: 'Plan & Billing', section: 'Admin', visible: true, core: true },
    { href: '/settings', label: 'Settings', section: 'Admin', visible: true, core: true },
    { href: '/admin', label: 'Admin Dashboard', section: 'Admin', visible: Boolean(isPlatformAdmin), feature: 'admin_plan_management' },
    { href: '/admin/plans', label: 'Plans', section: 'Admin', visible: Boolean(isPlatformAdmin), feature: 'admin_plan_management' },
    { href: '/admin/access', label: 'Access Invites', section: 'Admin', visible: Boolean(isPlatformAdmin), feature: 'admin_plan_management' },
  ]
  const nav = rawNav.filter((item) => item.visible)
  const sections: Array<NavItem['section']> = ['Workspace', 'Deal Flow', 'Intelligence', 'Admin']
  const trialDate = formatTrialDate(trialEndsAt)

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-white/10 bg-slate-950/95 p-5 lg:flex lg:flex-col">
        <Link href="/dashboard" className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:bg-white/[0.06]">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-sm font-black text-slate-950">DF</span>
          <span>
            <span className="block text-xl font-black tracking-tight">DealFlowIQ</span>
            <span className="block text-xs text-slate-500">Deal intelligence OS</span>
          </span>
        </Link>

        <div className="mt-5 rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.02] p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wide text-slate-500">Workspace</div>
              <div className="mt-1 truncate font-bold text-white">{organizationName || 'Organization'}</div>
              <div className="mt-1 truncate text-sm text-slate-400">{userEmail}</div>
            </div>
            <Link href="/settings" className="rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-slate-300 hover:bg-white/10">Edit</Link>
          </div>
          <div className="mt-4 rounded-2xl border border-white/10 bg-slate-900/70 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Account type</div>
            <div className="mt-1 text-sm font-bold">{config.title}</div>
            <div className="mt-3 flex flex-wrap gap-2"><PlanBadge planName={planName} subscriptionStatus={subscriptionStatus} /></div>
            {trialDate ? <div className="mt-2 text-xs text-emerald-300">Trial ends {trialDate}</div> : null}
          </div>
        </div>

        <nav className="mt-5 min-h-0 flex-1 space-y-6 overflow-y-auto pr-1 pb-4">
          {sections.map((section) => {
            const items = nav.filter((item) => item.section === section)
            if (!items.length) return null
            return (
              <div key={section}>
                <div className="px-3 text-[11px] font-black uppercase tracking-[0.2em] text-slate-600">{section}</div>
                <div className="mt-2 space-y-1">
                  {items.map((item) => {
                    const locked = Boolean(item.feature && !item.core && !canUseFeature(features, item.feature))
                    return (
                      <Link key={item.href} href={item.href} className="flex items-center justify-between gap-3 rounded-2xl px-3 py-3 text-sm font-semibold text-slate-300 transition hover:bg-white/10 hover:text-white">
                        <span>{item.label}</span>
                        {locked && item.feature ? <LockedPill feature={item.feature} /> : null}
                      </Link>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </nav>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 border-b border-white/10 bg-slate-950/90 px-4 py-3 backdrop-blur sm:px-6 lg:px-8">
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4">
            <div className="min-w-0">
              <Link href="/dashboard" className="font-black lg:hidden">DealFlowIQ</Link>
              <div className="hidden lg:block">
                <div className="text-xs uppercase tracking-wide text-slate-500">{config.shortTitle} workspace</div>
                <div className="truncate text-sm font-bold text-slate-200">{organizationName || 'Organization'} · {planName || 'Trial'}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <NotificationBell />
              <details className="relative">
                <summary className="flex cursor-pointer list-none items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 hover:bg-white/10">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-xs font-black text-slate-950">{(userEmail || 'U').slice(0, 1).toUpperCase()}</span>
                  <span className="hidden text-left sm:block">
                    <span className="block max-w-44 truncate text-sm font-bold text-white">{userEmail || 'Account'}</span>
                    <span className="block text-xs text-slate-500">Profile & workspace</span>
                  </span>
                </summary>
                <div className="absolute right-0 z-50 mt-3 w-72 overflow-hidden rounded-3xl border border-white/10 bg-slate-950 shadow-2xl shadow-black/50">
                  <div className="border-b border-white/10 p-4">
                    <div className="font-bold text-white">{organizationName || 'Workspace'}</div>
                    <div className="mt-1 truncate text-sm text-slate-400">{userEmail}</div>
                    <div className="mt-3"><PlanBadge planName={planName} subscriptionStatus={subscriptionStatus} /></div>
                  </div>
                  <div className="p-2">
                    <Link href="/settings" className="block rounded-2xl px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/10">Profile & Settings</Link>
                    <Link href="/settings/billing" className="block rounded-2xl px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/10">Plan & Billing</Link>
                    {isPlatformAdmin ? <Link href="/admin" className="block rounded-2xl px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/10">Admin Dashboard</Link> : null}
                    <form action={signOutAction} className="mt-2 border-t border-white/10 pt-2">
                      <button className="w-full rounded-2xl px-4 py-3 text-left text-sm font-bold text-red-200 hover:bg-red-500/10">Sign out</button>
                    </form>
                  </div>
                </div>
              </details>
            </div>
          </div>
          <nav className="mt-3 flex gap-2 overflow-x-auto pb-1 lg:hidden">
            {nav.map((item) => {
              const locked = Boolean(item.feature && !item.core && !canUseFeature(features, item.feature))
              return (
                <Link key={item.href} href={item.href} className="flex shrink-0 items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm font-semibold text-slate-300">
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
