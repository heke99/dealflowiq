import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalArticle, LegalList, LegalSection, SUPPORT_EMAIL } from '../legal'

export const metadata: Metadata = {
  title: 'Acceptable Use Policy',
  description: 'Rules for using DealFlowIQ responsibly.',
}

export default function AcceptableUsePage() {
  return (
    <LegalArticle
      title="Acceptable Use Policy"
      intro="DealFlowIQ hosts shared workspaces, communities, messaging and imported listing data. These rules keep the platform useful and safe for everyone. This policy is part of our Terms of Service, and violating it can lead to content removal, feature restrictions or account termination."
    >
      <LegalSection title="1. Only import data you are authorized to use">
        <LegalList
          items={[
            'Import listings only from sources you own, have a license for, or are otherwise authorized to use. You are responsible for complying with each provider\u2019s terms.',
            'Do not use DealFlowIQ to scrape, circumvent paywalls, rate limits or technical protections of listing sites, or to redistribute provider data beyond what your authorization allows.',
            'Respect data expiry: when provider data is removed under provider requirements, do not attempt to re-import it in violation of those requirements.',
          ]}
        />
      </LegalSection>

      <LegalSection title="2. No fraud or misrepresentation">
        <LegalList
          items={[
            'Do not post deals or listings you do not control or have no right to market, and do not misrepresent price, condition, rents, occupancy or your relationship to a property.',
            'Do not use the platform for advance-fee schemes, fake earnest-money requests, wire-fraud attempts or any other scam.',
            'Do not impersonate other people, brokers, lenders or companies, or claim professional credentials you do not hold.',
          ]}
        />
      </LegalSection>

      <LegalSection title="3. Messaging and community conduct">
        <LegalList
          items={[
            'No spam: unsolicited bulk messages, repeated identical outreach, or using free-plan message allowances to blast users is prohibited.',
            'No harassment, hate speech, threats or doxxing of other members, sellers, brokers or anyone else.',
            'Keep community posts relevant to real estate investing and follow any additional rules set by community owners.',
            'Do not share other users\u2019 personal or contact information beyond what they have chosen to make visible.',
          ]}
        />
      </LegalSection>

      <LegalSection title="4. Platform integrity">
        <LegalList
          items={[
            'Do not probe, scan or test the vulnerability of the service, bypass authentication or access data belonging to other workspaces.',
            'Do not resell, sublicense or white-label the service without a written agreement, and do not abuse trials or plan limits with duplicate accounts.',
            'Do not upload malware or use the service to build or train a competing dataset from other users\u2019 content.',
          ]}
        />
      </LegalSection>

      <LegalSection title="5. Legal compliance">
        <p>
          You must comply with all laws that apply to your activity, including real estate licensing and advertising rules in your state, fair-housing laws, anti-spam laws such as CAN-SPAM and TCPA for any outreach you conduct, and applicable privacy laws for personal data you handle.
        </p>
      </LegalSection>

      <LegalSection title="6. Reporting and enforcement">
        <p>
          Report suspected abuse through the <Link href="/support" className="font-semibold text-slate-200 underline hover:text-white">support page</Link> (category: abuse/report) or email <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold text-slate-200 underline hover:text-white">{SUPPORT_EMAIL}</a>. We review reports, may remove content or restrict features while investigating, and may suspend or terminate accounts for serious or repeated violations, as described in the <Link href="/terms" className="font-semibold text-slate-200 underline hover:text-white">Terms of Service</Link>.
        </p>
      </LegalSection>
    </LegalArticle>
  )
}
