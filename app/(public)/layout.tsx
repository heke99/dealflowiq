import Link from 'next/link'
import { PublicFooter } from '@/components/layout/PublicFooter'

export default function PublicLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-white">
      <header className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-6">
        <Link href="/" className="text-2xl font-bold tracking-tight">DealFlowIQ</Link>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/plans" className="hidden px-3 py-2 font-semibold text-slate-300 hover:text-white sm:block">Pricing</Link>
          <Link href="/login" className="rounded-xl border border-white/10 px-4 py-2 font-semibold text-slate-100 hover:bg-white/10">Log in</Link>
          <Link href="/signup" className="rounded-xl bg-white px-4 py-2 font-semibold text-slate-950 hover:bg-slate-200">Sign up</Link>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 pb-20 pt-8">{children}</main>
      <PublicFooter />
    </div>
  )
}
