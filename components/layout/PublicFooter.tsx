import Link from 'next/link'

export function PublicFooter() {
  return (
    <footer className="border-t border-white/10 bg-slate-950 px-6 py-8 text-sm text-slate-400">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-black text-white">DealFlowIQ</div>
          <div className="mt-1">Operated by Diversa Solutions LLC.</div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <a href="mailto:support@dealfloowiq.com" className="font-semibold text-slate-200 hover:text-white">support@dealfloowiq.com</a>
          <Link href="/login" className="hover:text-white">Log in</Link>
          <Link href="/signup" className="hover:text-white">Get started</Link>
        </div>
      </div>
    </footer>
  )
}
