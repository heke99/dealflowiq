import type { Metadata } from 'next'
import Link from 'next/link'
import { submitSupportRequestAction } from './actions'
import { SUPPORT_EMAIL } from '../legal'

export const metadata: Metadata = {
  title: 'Support',
  description: 'Get help with billing, imports, account access or reporting abuse.',
}

const categories = [
  { value: 'billing', label: 'Billing' },
  { value: 'imports_listings', label: 'Imports & listings' },
  { value: 'abuse_report', label: 'Abuse / report' },
  { value: 'account_access', label: 'Account access' },
  { value: 'other', label: 'Other' },
]

const expectations = [
  { title: 'Billing', text: 'Plan changes, trial questions, invoices and refunds. Include the email on the subscription.' },
  { title: 'Imports & listings', text: 'Failed imports, missing fields, stale data or provider expiry questions. Include the listing URL if you can.' },
  { title: 'Abuse / report', text: 'Spam, scams, harassment or content that violates the Acceptable Use Policy. Reports are reviewed with priority.' },
  { title: 'Account access', text: 'Login trouble, password resets that never arrive, or a workspace you have lost access to.' },
]

export default async function SupportPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const qs = await searchParams
  const success = qs?.success === '1'
  const errorMessage = typeof qs?.error === 'string' ? qs.error : ''

  return (
    <div className="mx-auto max-w-5xl">
      <div className="max-w-3xl">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Support</h1>
        <p className="mt-4 text-lg leading-8 text-slate-300">
          Send us a message and we will get back to you by email. You can also reach us directly at{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold text-white underline hover:text-slate-200">{SUPPORT_EMAIL}</a>.
        </p>
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-8">
          {success ? (
            <div className="mb-5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">
              Request received. We will reply to the email address you provided — check your spam folder if you do not hear back.
            </div>
          ) : null}
          {errorMessage ? (
            <div className="mb-5 rounded-2xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm text-amber-100">{errorMessage}</div>
          ) : null}

          <form action={submitSupportRequestAction} className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-semibold text-slate-300">
                Name (optional)
                <input name="name" placeholder="Your name" className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm font-normal text-slate-100 outline-none placeholder:text-slate-600 focus:border-white/30" />
              </label>
              <label className="grid gap-2 text-sm font-semibold text-slate-300">
                Email
                <input name="email" type="email" required placeholder="you@example.com" className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm font-normal text-slate-100 outline-none placeholder:text-slate-600 focus:border-white/30" />
              </label>
            </div>
            <label className="grid gap-2 text-sm font-semibold text-slate-300">
              Category
              <select name="category" defaultValue="other" className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm font-normal text-slate-100 outline-none">
                {categories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-semibold text-slate-300">
              Message
              <textarea name="message" rows={7} required maxLength={4000} placeholder="What happened, what you expected, and any listing URLs or workspace details that help us investigate." className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm font-normal leading-6 text-slate-100 outline-none placeholder:text-slate-600 focus:border-white/30" />
            </label>
            <button className="rounded-xl bg-white px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-200">Send request</button>
            <p className="text-xs leading-5 text-slate-500">
              One request per email every 10 minutes. By submitting you agree to our{' '}
              <Link href="/terms" className="underline hover:text-slate-300">Terms</Link> and{' '}
              <Link href="/privacy" className="underline hover:text-slate-300">Privacy Policy</Link>.
            </p>
          </form>
        </div>

        <div className="space-y-4">
          {expectations.map((item) => (
            <div key={item.title} className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
              <h2 className="font-bold text-white">{item.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">{item.text}</p>
            </div>
          ))}
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 text-sm leading-6 text-slate-400">
            Reporting abuse? Review the{' '}
            <Link href="/acceptable-use" className="font-semibold text-slate-200 underline hover:text-white">Acceptable Use Policy</Link>{' '}
            so your report includes what we need to act quickly.
          </div>
        </div>
      </div>
    </div>
  )
}
