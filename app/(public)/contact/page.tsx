import type { Metadata } from 'next'
import Link from 'next/link'
import { SUPPORT_EMAIL } from '../legal'

export const metadata: Metadata = {
  title: 'Contact',
  description: 'How to reach the DealFlowIQ team.',
}

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Contact</h1>
      <p className="mt-4 text-lg leading-8 text-slate-300">
        The fastest way to reach us is the support form — it routes your message to the right place and keeps a record we can follow up on.
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-xl font-bold">Support form</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Billing, imports and listings, account access, abuse reports and anything else about the product.
          </p>
          <Link href="/support" className="mt-5 inline-flex rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-200">Open support</Link>
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-xl font-bold">Email</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Prefer email? Write to us directly and include your account email so we can find your workspace.
          </p>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="mt-5 inline-flex rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10">{SUPPORT_EMAIL}</a>
        </div>
      </div>

      <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-6 text-sm leading-7 text-slate-400">
        <p>
          Legal questions? Our <Link href="/terms" className="font-semibold text-slate-200 underline hover:text-white">Terms of Service</Link>,{' '}
          <Link href="/privacy" className="font-semibold text-slate-200 underline hover:text-white">Privacy Policy</Link> and{' '}
          <Link href="/disclaimer" className="font-semibold text-slate-200 underline hover:text-white">Disclaimer</Link> answer the most common ones.
          For anything about how DealFlowIQ analyses should be interpreted, read the disclaimer first — every score and estimate must be independently verified before you act on it.
        </p>
      </div>
    </div>
  )
}
