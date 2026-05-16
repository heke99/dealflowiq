import Link from 'next/link'
import type { ComponentType } from 'react'
import {
  BadgeDollarSign,
  BarChart3,
  Bell,
  Building2,
  Calculator,
  Crown,
  DatabaseZap,
  FileSearch,
  Heart,
  Home,
  LayoutDashboard,
  LineChart,
  Lock,
  LogOut,
  Search,
  Settings,
  ShieldCheck,
  Target,
  Users,
} from 'lucide-react'
import { signOutAction } from '@/lib/auth/actions'
import type { FeatureMap, FeatureKey } from '@/lib/billing/features'
import { canUseFeature, featureLabels } from '@/lib/billing/features'
import { getAccountTypeConfig } from '@/lib/product/accountTypes'

type IconType = ComponentType<{ className?: string }>

type NavItem = {
  href: string
  label: string
  description?: string
  icon: IconType
  visible?: boolean
  feature?: FeatureKey
  core?: boolean
}

type NavGroup = {
  label: string
  items: NavItem[]
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

function statusLabel(status?: string | null) {
  const normalized = String(status || 'active').replaceAll('_', ' ')
  if (!status || status === 'trialing') return 'Active access'
  if (status === 'manually_granted') return 'Manual access'
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

function initials(value?: string | null) {
  return String(value || 'DealFlowIQ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'DF'
}

function LockedPill({ feature }: { feature: FeatureKey }) {
  return (
    <span title={`${featureLabels[feature]} is not included in the current plan.`} className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-amber-100">
      <Lock className="h-3 w-3" />
      Locked
    </span>
  )
}

function NavLink({ item, locked }: { item: NavItem; locked: boolean }) {
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      className={`group flex items-center gap-3 rounded-2xl border px-3 py-3 transition ${locked ? 'border-white/5 bg-white/[0.02] text-slate-500 hover:border-amber-400/20 hover:bg-amber-400/5 hover:text-slate-200' : 'border-transparent text-slate-300 hover:border-white/10 hover:bg-white/[0.06] hover:text-white'}`}
    >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${locked ? 'border-white/5 bg-slate-900/80 text-slate-500' : 'border-white/10 bg-white/[0.04] text-slate-200 group-hover:bg-white/[0.08]'}`}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">{item.label}</span>
        {item.description ? <span className="mt-0.5 block truncate text-xs text-slate-500">{item.description}</span> : null}
      </span>
      {locked && item.feature ? <LockedPill feature={item.feature} /> : null}
    </Link>
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
  isPlatformAdmin,
}: AppShellProps) {
  const config = getAccountTypeConfig(accountType)
  const navGroups: NavGroup[] = [
    {
      label: 'Overview',
      items: [
        { href: '/dashboard', label: 'Dashboard', description: 'Pipeline overview', icon: LayoutDashboard, core: true },
        { href: '/notifications', label: 'Notifications', description: 'Tasks and alerts', icon: Bell, core: true },
      ],
    },
    {
      label: 'Deal flow',
      items: [
        { href: '/market', label: 'Market', description: 'Listings and review', icon: Search, feature: 'market_opportunities', core: true },
        { href: '/opportunities', label: 'Opportunities', description: 'Qualified deals', icon: Target, feature: 'market_opportunities', core: true },
        { href: '/saved-deals', label: 'Saved Deals', description: 'Your watchlist', icon: Heart, feature: 'market_opportunities', core: true },
        { href: '/deals', label: 'My Deals', description: 'Manual underwriting', icon: Building2, feature: 'deals', core: true },
        { href: '/market-search', label: 'Source Imports', description: 'Import sources', icon: DatabaseZap, feature: 'market_source_imports' },
        { href: '/buy-boxes', label: 'Buy Boxes', description: 'Matching rules', icon: FileSearch, feature: 'scheduled_market_imports' },
      ],
    },
    {
      label: 'Analysis',
      items: [
        { href: '/rent-analysis', label: 'Rent Analysis', description: 'Rent and HUD logic', icon: LineChart, feature: 'rent_analysis', core: true },
        { href: '/calculators', label: 'Calculators', description: 'BRRRR, flip, DSCR', icon: Calculator, feature: 'calculators', core: true },
        { href: '/buyers', label: 'Buyers', description: 'CRM and matching', icon: Users, feature: 'buyers' },
      ],
    },
    {
      label: 'Community',
      items: [
        { href: '/community', label: 'Community', description: 'Invites and members', icon: Crown, core: true },
      ],
    },
    {
      label: 'Settings',
      items: [
        { href: '/settings/billing', label: 'Plan & Billing', description: 'Access and plan', icon: BadgeDollarSign, core: true },
        { href: '/settings/underwriting', label: 'Underwriting Defaults', description: 'Assumptions', icon: BarChart3, core: true },
        { href: '/settings', label: 'Workspace Settings', description: 'Team and profile', icon: Settings, core: true },
      ],
    },
    {
      label: 'Platform admin',
      items: [
        { href: '/admin', label: 'Admin Dashboard', description: 'Control center', icon: ShieldCheck, visible: Boolean(isPlatformAdmin), feature: 'admin_plan_management' },
        { href: '/admin/plans', label: 'Plans & Subscriptions', description: 'Products and access', icon: BadgeDollarSign, visible: Boolean(isPlatformAdmin), feature: 'admin_plan_management' },
        { href: '/admin/access', label: 'Access Invites', description: 'Manual grants', icon: Users, visible: Boolean(isPlatformAdmin), feature: 'admin_plan_management' },
      ],
    },
  ]

  const visibleGroups = navGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => item.visible !== false) }))
    .filter((group) => group.items.length > 0)

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.13),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.11),transparent_30%)]" />

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-80 border-r border-white/10 bg-slate-950/92 p-5 shadow-2xl shadow-black/30 backdrop-blur-xl lg:flex lg:flex-col">
        <Link href="/dashboard" className="flex items-center gap-3 rounded-3xl border border-white/10 bg-white/[0.04] p-4 transition hover:bg-white/[0.06]">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-lg font-black text-slate-950">DF</span>
          <span>
            <span className="block text-2xl font-black tracking-tight">DealFlowIQ</span>
            <span className="block text-xs font-medium uppercase tracking-wide text-slate-500">Investor operating system</span>
          </span>
        </Link>

        <div className="mt-5 rounded-3xl border border-white/10 bg-white/[0.035] p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-slate-900 font-black text-white">{initials(organizationName || userEmail)}</div>
            <div className="min-w-0">
              <div className="truncate font-black">{organizationName || 'Workspace'}</div>
              <div className="truncate text-xs text-slate-500">{userEmail}</div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-3">
              <div className="text-slate-500">Plan</div>
              <div className="mt-1 truncate font-bold text-white">{planName || 'Active plan'}</div>
            </div>
            <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-3">
              <div className="text-emerald-200/70">Status</div>
              <div className="mt-1 truncate font-bold text-emerald-100">{isPlatformAdmin ? 'Platform admin' : statusLabel(subscriptionStatus)}</div>
            </div>
          </div>
          <div className="mt-2 rounded-2xl border border-white/10 bg-slate-900/70 p-3 text-xs text-slate-400">
            <span className="font-semibold text-slate-200">{config.title}</span> · tools are grouped by workflow so users find the next step faster.
          </div>
        </div>

        <nav className="mt-5 min-h-0 flex-1 space-y-6 overflow-y-auto pr-1 pb-4">
          {visibleGroups.map((group) => (
            <div key={group.label}>
              <div className="mb-2 px-3 text-[11px] font-black uppercase tracking-[0.18em] text-slate-600">{group.label}</div>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const locked = Boolean(item.feature && !item.core && !canUseFeature(features, item.feature))
                  return <NavLink key={item.href} item={item} locked={locked} />
                })}
              </div>
            </div>
          ))}
        </nav>

        <form action={signOutAction} className="border-t border-white/10 pt-4">
          <button className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 px-4 py-3 text-sm font-black text-slate-200 transition hover:border-red-400/30 hover:bg-red-500/10 hover:text-red-100">
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </form>
      </aside>

      <div className="relative lg:pl-80">
        <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/90 px-4 py-4 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-4">
            <Link href="/dashboard" className="flex items-center gap-2 font-black"><Home className="h-5 w-5" /> DealFlowIQ</Link>
            <form action={signOutAction}>
              <button className="rounded-xl border border-white/10 px-3 py-2 text-sm font-bold">Sign out</button>
            </form>
          </div>
          <nav className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {visibleGroups.flatMap((group) => group.items).map((item) => {
              const locked = Boolean(item.feature && !item.core && !canUseFeature(features, item.feature))
              const Icon = item.icon
              return (
                <Link key={item.href} href={item.href} className="flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-bold text-slate-300">
                  <Icon className="h-4 w-4" />
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
