import Link from 'next/link'

type FooterColumn = {
  title: string
  links: { label: string; href: string }[]
}

const columns: FooterColumn[] = [
  {
    title: 'Product',
    links: [
      { label: 'Home', href: '/' },
      { label: 'Pricing', href: '/plans' },
      { label: 'Log in', href: '/login' },
      { label: 'Sign up', href: '/signup' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Terms', href: '/terms' },
      { label: 'Privacy', href: '/privacy' },
      { label: 'Cookies', href: '/cookies' },
      { label: 'Disclaimer', href: '/disclaimer' },
      { label: 'Acceptable Use', href: '/acceptable-use' },
    ],
  },
  {
    title: 'Support',
    links: [
      { label: 'Support', href: '/support' },
      { label: 'Contact', href: '/contact' },
    ],
  },
]

export function PublicFooter() {
  return (
    <footer className="border-t border-white/10 bg-slate-950 px-6 py-12 text-sm text-slate-400">
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1.2fr_2fr]">
        <div>
          <div className="text-lg font-bold text-white">DealFlowIQ</div>
          <div className="mt-1 text-slate-400">Real estate underwriting OS</div>
          <div className="mt-4 text-xs leading-5 text-slate-500">
            Operated by Diversa Solutions LLC.
            <br />
            <a href="mailto:support@dealflowiq.com" className="font-semibold text-slate-400 hover:text-white">support@dealflowiq.com</a>
          </div>
        </div>
        <div className="grid gap-8 sm:grid-cols-3">
          {columns.map((column) => (
            <div key={column.title}>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{column.title}</div>
              <ul className="mt-3 space-y-2">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="hover:text-white">{link.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="mx-auto mt-10 max-w-7xl border-t border-white/10 pt-6 text-xs leading-5 text-slate-500">
        © {new Date().getFullYear()} DealFlowIQ. Estimates only — not legal, tax, investment, lending or financial advice. Verify all data independently before acting on any analysis.
      </div>
    </footer>
  )
}
