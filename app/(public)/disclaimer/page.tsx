import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalArticle, LegalList, LegalSection, SUPPORT_EMAIL } from '../legal'

export const metadata: Metadata = {
  title: 'Disclaimer',
  description: 'Important limits on DealFlowIQ analyses, scores and data.',
}

export default function DisclaimerPage() {
  return (
    <LegalArticle
      title="Disclaimer"
      intro="DealFlowIQ is an analysis tool for real estate investors. Nothing on this platform is legal, tax, investment, lending or financial advice, and no output is a guarantee of how a property will perform. Please read this page before relying on any number the product shows you."
    >
      <LegalSection title="1. Analysis tools only — not advice">
        <p>
          Deal scores, rent estimates, DSCR, cap rate, cashflow projections, strategy previews (flip, BRRRR, wholesale) and every other output are computational estimates produced from the inputs and assumptions available at the time. They are provided for informational purposes only. DealFlowIQ is not a licensed broker, lender, appraiser, accountant, attorney or investment adviser, and using the platform does not create any advisory or fiduciary relationship. Before purchasing, financing, renting or selling real estate, consult qualified professionals — an attorney, CPA, lender, appraiser and local property manager — who can evaluate your specific situation.
        </p>
      </LegalSection>

      <LegalSection title="2. Verify all data independently">
        <p>
          You are responsible for independently verifying every material fact about a property before acting: price, rents, taxes, insurance, HOA dues, utilities, rehab scope and cost, zoning, permits, title, occupancy and condition. Numbers that look precise in the product are still estimates built from imperfect inputs.
        </p>
      </LegalSection>

      <LegalSection title="3. Imported listing data may be incomplete or stale">
        <LegalList
          items={[
            'Listing data is imported from sources users designate as authorized. We do not control those sources and cannot guarantee their accuracy, completeness or timeliness.',
            'Listings change quickly: prices are reduced, properties go under contract or sell, and details get corrected. Imported data may lag the source or be missing fields entirely.',
            'Provider data can expire and be removed under provider requirements, which may leave analyses based on data that is no longer viewable.',
            'HUD Fair Market Rent values are government benchmarks, not guaranteed contract rents, and actual Section 8 payment standards vary by housing authority.',
          ]}
        />
      </LegalSection>

      <LegalSection title="4. Scores are estimates, not guarantees">
        <p>
          The DealFlowIQ score ranks deals using rent upside, projected cashflow, DSCR, cap rate, risk signals and data confidence. A high score means the available inputs look favorable — it does not mean a deal will be profitable, that financing will be approved, or that estimated rents are achievable. A low score may simply reflect missing data. Confidence indicators describe data quality, not certainty of outcome. Past or modeled performance never guarantees future results.
        </p>
      </LegalSection>

      <LegalSection title="5. User-generated content">
        <p>
          Deals, notes, messages and community posts are created by users, not by DealFlowIQ. We do not endorse or verify claims made by other users, including claims about property performance, off-market availability or investment returns. Treat unverified claims with the same skepticism you would apply anywhere else, and report abuse through the <Link href="/support" className="font-semibold text-slate-200 underline hover:text-white">support page</Link>.
        </p>
      </LegalSection>

      <LegalSection title="6. Risk of real estate investing">
        <p>
          Real estate investing involves substantial risk, including loss of principal. Vacancies, non-payment, repairs, market downturns, interest-rate changes, regulatory changes and inaccurate assumptions can all cause actual results to differ materially from any projection shown in DealFlowIQ. Only invest what you can afford to put at risk.
        </p>
      </LegalSection>

      <LegalSection title="7. Questions">
        <p>
          This disclaimer is incorporated into our <Link href="/terms" className="font-semibold text-slate-200 underline hover:text-white">Terms of Service</Link>. If anything here is unclear, contact <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold text-slate-200 underline hover:text-white">{SUPPORT_EMAIL}</a>.
        </p>
      </LegalSection>
    </LegalArticle>
  )
}
