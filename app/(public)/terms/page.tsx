import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalArticle, LegalList, LegalSection, SUPPORT_EMAIL } from '../legal'

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The terms that govern your use of DealFlowIQ.',
}

export default function TermsPage() {
  return (
    <LegalArticle
      title="Terms of Service"
      intro="These Terms of Service govern your access to and use of DealFlowIQ, a software platform for sourcing, analyzing and organizing real estate investment opportunities. By creating an account or using the service you agree to these terms."
    >
      <LegalSection title="1. The service">
        <p>
          DealFlowIQ provides tools for importing property listings from authorized sources, estimating rents, calculating underwriting metrics such as DSCR, cap rate and cashflow, scoring deals, and collaborating with team or community members. DealFlowIQ is an analysis tool only. It does not broker, buy, sell or lend against real estate, and it does not provide legal, tax, investment, lending or financial advice. See our <Link href="/disclaimer" className="font-semibold text-slate-200 underline hover:text-white">Disclaimer</Link> for details.
        </p>
      </LegalSection>

      <LegalSection title="2. Accounts and eligibility">
        <p>
          You must provide accurate registration information and keep your credentials secure. You are responsible for all activity under your account, including activity by workspace or community members you invite. You must be at least 18 years old and able to form a binding contract to use the service. If you use DealFlowIQ on behalf of an organization, you represent that you are authorized to bind that organization to these terms.
        </p>
      </LegalSection>

      <LegalSection title="3. Plans, billing and trials">
        <p>
          Paid plans are billed through Stripe, our payment processor. By subscribing you authorize recurring charges for your selected plan until you cancel. Trials convert to paid subscriptions unless cancelled before the trial ends. Prices and plan limits (such as import quotas or visible opportunity counts) may change; we will give reasonable notice of material changes. Except where required by law, payments are non-refundable, though you may cancel at any time and retain access for the paid period.
        </p>
      </LegalSection>

      <LegalSection title="4. Your content">
        <p>
          You retain ownership of the content you submit — deals, notes, messages, community posts and imported data you are authorized to use. You grant DealFlowIQ a limited license to host, process and display that content solely to operate the service, including generating scores and analyses from it. You are responsible for ensuring that anything you import or post does not infringe third-party rights or violate any agreement you have with a data provider.
        </p>
      </LegalSection>

      <LegalSection title="5. Listing data and third-party sources">
        <p>
          Imported listing data comes from sources you designate and represent as authorized. Provider data may be subject to expiry and removal in line with provider requirements. We do not guarantee that listing data is accurate, complete or current, and we may remove content that violates provider terms or these terms.
        </p>
      </LegalSection>

      <LegalSection title="6. Acceptable use">
        <p>
          Your use of the service must comply with our <Link href="/acceptable-use" className="font-semibold text-slate-200 underline hover:text-white">Acceptable Use Policy</Link>, which prohibits, among other things, unauthorized scraping, abusive messaging, spam and attempts to interfere with the platform.
        </p>
      </LegalSection>

      <LegalSection title="7. Disclaimers and limitation of liability">
        <LegalList
          items={[
            'The service is provided "as is" and "as available", without warranties of any kind, express or implied.',
            'All scores, rent estimates and underwriting outputs are estimates, not guarantees of performance or value.',
            'To the maximum extent permitted by law, DealFlowIQ and its operator are not liable for indirect, incidental, special or consequential damages, or for investment decisions made using the service.',
            'Our total liability for any claim is limited to the amounts you paid for the service in the 12 months before the claim arose.',
          ]}
        />
      </LegalSection>

      <LegalSection title="8. Suspension and termination">
        <p>
          We may suspend or terminate accounts that violate these terms, abuse the platform or create risk for other users or data providers. You may stop using the service and delete your account at any time. Sections that by their nature should survive termination (such as ownership, disclaimers and limitations of liability) survive.
        </p>
      </LegalSection>

      <LegalSection title="9. Changes and governing law">
        <p>
          We may update these terms from time to time; material changes will be reflected in the last-updated date above and, where appropriate, notified in-app or by email. Continued use after changes take effect constitutes acceptance. These terms are governed by the laws of the operator&apos;s jurisdiction, without regard to conflict-of-law rules.
        </p>
      </LegalSection>

      <LegalSection title="10. Contact">
        <p>
          Questions about these terms? Reach us at <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold text-slate-200 underline hover:text-white">{SUPPORT_EMAIL}</a> or through the <Link href="/support" className="font-semibold text-slate-200 underline hover:text-white">support page</Link>.
        </p>
      </LegalSection>
    </LegalArticle>
  )
}
