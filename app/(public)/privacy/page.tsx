import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalArticle, LegalList, LegalSection, SUPPORT_EMAIL } from '../legal'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How DealFlowIQ collects, uses and protects your data.',
}

export default function PrivacyPage() {
  return (
    <LegalArticle
      title="Privacy Policy"
      intro="This policy explains what information DealFlowIQ collects, how it is used, who processes it on our behalf, and the choices you have. It applies to the DealFlowIQ website and application."
    >
      <LegalSection title="1. Information we collect">
        <LegalList
          items={[
            'Account information: name, email address, password (stored as a hash by our authentication provider), account type and workspace or community membership.',
            'Content you create: deals, underwriting inputs and assumptions, notes, saved searches and buy boxes, messages, and community posts.',
            'Imported listing data: property details you import from sources you designate as authorized, along with derived analyses such as rent estimates and deal scores.',
            'Billing information: subscription plan, billing status and payment events. Card details are collected and stored by Stripe, not by DealFlowIQ.',
            'Usage and log data: authentication events, feature usage, audit records of significant actions, and technical data needed to keep the service secure.',
          ]}
        />
      </LegalSection>

      <LegalSection title="2. How we use information">
        <LegalList
          items={[
            'To provide the service: run imports, calculate scores and underwriting outputs, deliver messages and notifications, and operate workspaces and communities.',
            'To manage billing: process subscriptions, trials, upgrades and cancellations through Stripe.',
            'To communicate with you: transactional email such as account confirmation, password resets, invites and support responses (optionally delivered via Resend).',
            'To keep the platform safe: detect abuse, enforce plan limits, investigate reports and maintain audit logs.',
          ]}
        />
        <p>We do not sell your personal information, and we do not use your deal data for advertising.</p>
      </LegalSection>

      <LegalSection title="3. Service providers">
        <p>
          We rely on a small number of processors to run DealFlowIQ: Supabase provides authentication, database and storage infrastructure; Stripe processes payments; Resend may be used to deliver transactional email. Each provider processes data only as needed to supply its service and under its own security and privacy commitments. Listing data may also originate from third-party providers you authorize; their terms govern that data at its source.
        </p>
      </LegalSection>

      <LegalSection title="4. Sharing within workspaces and communities">
        <p>
          DealFlowIQ is collaborative. Content you add to a shared workspace or community — deals, notes, posts, listing contact settings — is visible to other members according to the visibility rules you and your workspace administrators choose. Direct messages are visible to their participants. Be thoughtful about what you share.
        </p>
      </LegalSection>

      <LegalSection title="5. Cookies">
        <p>
          We use a small set of cookies, primarily to keep you signed in. See the <Link href="/cookies" className="font-semibold text-slate-200 underline hover:text-white">Cookie Policy</Link> for the full list and your options.
        </p>
      </LegalSection>

      <LegalSection title="6. Retention and deletion">
        <p>
          We keep your data for as long as your account is active or as needed to provide the service. Imported provider data may expire and be removed earlier under provider requirements, while your own analyses and notes are retained. When you delete your account we delete or anonymize personal data within a reasonable period, except where we must retain records for legal, billing or security reasons (for example, audit logs and payment records).
        </p>
      </LegalSection>

      <LegalSection title="7. Your rights">
        <p>
          Depending on where you live, you may have rights to access, correct, export or delete your personal information, and to object to or restrict certain processing. You can exercise most of these directly in the app (account settings) or by contacting us. We will respond to verified requests within the timelines required by applicable law.
        </p>
      </LegalSection>

      <LegalSection title="8. Security">
        <p>
          We use industry-standard measures to protect your data, including encrypted connections, hashed credentials, row-level security on database access, and scoped service credentials. No system is perfectly secure; if we learn of a breach affecting your personal data we will notify you as required by law.
        </p>
      </LegalSection>

      <LegalSection title="9. Children">
        <p>DealFlowIQ is not directed to children and may not be used by anyone under 18. We do not knowingly collect personal information from children.</p>
      </LegalSection>

      <LegalSection title="10. Changes and contact">
        <p>
          We may update this policy; material changes will be reflected in the last-updated date above and, where appropriate, notified in-app or by email. Questions or requests: <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold text-slate-200 underline hover:text-white">{SUPPORT_EMAIL}</a> or the <Link href="/support" className="font-semibold text-slate-200 underline hover:text-white">support page</Link>.
        </p>
      </LegalSection>
    </LegalArticle>
  )
}
