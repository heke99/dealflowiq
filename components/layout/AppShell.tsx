import Link from 'next/link'
import { signOutAction } from '@/lib/auth/actions'

type AppShellProps = {
  children: React.ReactNode
  organizationName?: string | null
  userEmail?: string | null
}

const navigation = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/deals', label: 'Deals' },
  { href: '/buyers', label: 'Buyers' },
  { href: '/settings', label: 'Settings' },
]

export function AppShell({ children, organizationName, userEmail }: AppShellProps) {
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
        </div>

        <nav className="mt-8 space-y-1">
          {navigation.map((item) => (
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
            {navigation.map((item) => (
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
