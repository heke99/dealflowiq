import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalArticle, LegalSection, SUPPORT_EMAIL } from '../legal'

export const metadata: Metadata = {
  title: 'Cookie Policy',
  description: 'How DealFlowIQ uses cookies and similar technologies.',
}

const cookieRows = [
  {
    name: 'Authentication cookies (Supabase)',
    purpose: 'Keep you signed in to your workspace and refresh your session securely. Set when you log in and cleared when you sign out or the session expires.',
    type: 'Essential',
  },
  {
    name: 'Billing session cookies (Stripe)',
    purpose: 'Used by Stripe during checkout and billing management to process payments securely and prevent fraud. Only set when you interact with billing.',
    type: 'Essential',
  },
]

export default function CookiesPage() {
  return (
    <LegalArticle
      title="Cookie Policy"
      intro="DealFlowIQ uses a deliberately small set of cookies. We do not use advertising cookies or sell data derived from cookies. This page explains what we set and why."
    >
      <LegalSection title="1. What cookies are">
        <p>
          Cookies are small text files that a website stores in your browser. They let the site remember things between requests — most importantly for DealFlowIQ, that you are signed in. Similar technologies such as local storage may be used for the same purposes; this policy covers those too.
        </p>
      </LegalSection>

      <LegalSection title="2. Cookies we use">
        <div className="overflow-hidden rounded-2xl border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/[0.04] text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Cookie</th>
                <th className="px-4 py-3 font-semibold">Purpose</th>
                <th className="px-4 py-3 font-semibold">Type</th>
              </tr>
            </thead>
            <tbody>
              {cookieRows.map((row) => (
                <tr key={row.name} className="border-t border-white/10">
                  <td className="px-4 py-3 font-semibold text-slate-200">{row.name}</td>
                  <td className="px-4 py-3 leading-6 text-slate-400">{row.purpose}</td>
                  <td className="px-4 py-3 text-slate-300">{row.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Essential cookies are required for the service to work — without the authentication cookie you cannot stay logged in, and without Stripe&apos;s cookies you cannot complete checkout. Because we only use essential cookies, we do not show a consent banner; using the logged-in product requires them.
        </p>
      </LegalSection>

      <LegalSection title="3. What we do not use">
        <p>
          We do not set third-party advertising or cross-site tracking cookies, and we do not embed social media trackers on legal or marketing pages. If we ever introduce optional analytics cookies, we will update this policy and give you a way to opt out before they are set.
        </p>
      </LegalSection>

      <LegalSection title="4. Managing cookies">
        <p>
          You can delete or block cookies in your browser settings at any time. Blocking essential cookies will sign you out and prevent login and checkout from working. Signing out of DealFlowIQ removes your session cookies.
        </p>
      </LegalSection>

      <LegalSection title="5. More information">
        <p>
          For how we handle the data behind these cookies, see the <Link href="/privacy" className="font-semibold text-slate-200 underline hover:text-white">Privacy Policy</Link>. Questions: <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold text-slate-200 underline hover:text-white">{SUPPORT_EMAIL}</a>.
        </p>
      </LegalSection>
    </LegalArticle>
  )
}
