import type { createDealAction, updateDealAction } from '@/app/deals/actions'
import type { UnderwritingDefaults } from '@/lib/underwriting/defaults'

type Action = typeof createDealAction | typeof updateDealAction

type DealFormProps = {
  action: Action
  submitLabel: string
  deal?: Record<string, any> | null
  property?: Record<string, any> | null
  error?: string | null
  assumptionDefaults?: UnderwritingDefaults | null
}

const statuses = [
  ['draft', 'Draft'],
  ['imported', 'Imported'],
  ['needs_review', 'Needs Review'],
  ['analyzed', 'Analyzed'],
  ['approved', 'Approved'],
  ['rejected', 'Rejected'],
  ['under_contract', 'Under Contract'],
  ['sent_to_buyers', 'Sent to Buyers'],
  ['offers_received', 'Offers Received'],
  ['assigned', 'Assigned'],
  ['closed', 'Closed'],
  ['dead', 'Dead'],
]

const propertyTypes = [
  'Single Family',
  'Duplex',
  'Triplex',
  'Fourplex',
  'Multifamily',
  'Condo',
  'Townhouse',
  'Mixed Use',
  'Commercial',
  'Land',
]

function value(row: Record<string, any> | null | undefined, key: string) {
  const current = row?.[key]
  return current === null || current === undefined ? '' : String(current)
}

function Field({ label, name, type = 'text', placeholder, defaultValue, help }: { label: string; name: string; type?: string; placeholder?: string; defaultValue?: string; help?: string }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-300">{label}</span>
      <input
        name={name}
        type={type}
        step={type === 'number' ? '0.01' : undefined}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-white/30"
      />
      {help ? <span className="mt-1 block text-xs leading-5 text-slate-500">{help}</span> : null}
    </label>
  )
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
      <div>
        <h2 className="text-xl font-bold">{title}</h2>
        <p className="mt-1 text-sm text-slate-400">{description}</p>
      </div>
      <div className="mt-6 grid gap-5 md:grid-cols-2">{children}</div>
    </section>
  )
}

export function DealForm({ action, submitLabel, deal, property, error, assumptionDefaults }: DealFormProps) {
  const defaults = assumptionDefaults
  return (
    <form action={action} encType="multipart/form-data" className="space-y-6">
      {deal?.id ? <input type="hidden" name="deal_id" value={deal.id} /> : null}
      {error ? <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">{error}</div> : null}

      <Section title="Deal basics" description="Create the core record first. Calculators and projections will use these numbers later.">
        <Field label="Deal name" name="title" placeholder="123 Main St rental deal" defaultValue={value(deal, 'title')} />
        <label className="block">
          <span className="text-sm font-medium text-slate-300">Status</span>
          <select name="status" defaultValue={value(deal, 'status') || 'draft'} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none focus:border-white/30">
            {statuses.map(([status, label]) => <option key={status} value={status}>{label}</option>)}
          </select>
        </label>
        <Field label="Source URL" name="source_url" placeholder="https://..." defaultValue={value(deal, 'source_url')} />
        <Field label="Source platform" name="source_platform" placeholder="Zillow, InvestorLift, manual, PDF..." defaultValue={value(deal, 'source_platform')} />
        <Field label="Primary image URL" name="primary_image_url" placeholder="https://.../property-photo.jpg" defaultValue={value(deal, 'primary_image_url')} help="Used on Market, Opportunities and deal cards. Use images you have the right to display." />
        <Field label="Additional image URLs" name="image_urls" placeholder="One or more image URLs, separated by commas or new lines" defaultValue={Array.isArray(deal?.image_urls) ? deal?.image_urls.join('\n') : value(deal, 'image_urls')} help="Optional gallery images for Market cards and future deal pages." />
        <label className="block md:col-span-2">
          <span className="text-sm font-medium text-slate-300">Upload photos and documents</span>
          <input
            name="deal_files"
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            multiple
            className="mt-2 w-full rounded-xl border border-dashed border-white/15 bg-slate-900/80 px-4 py-4 text-sm text-slate-300 file:mr-4 file:rounded-lg file:border-0 file:bg-white file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-950 hover:border-white/30"
          />
          <span className="mt-1 block text-xs leading-5 text-slate-500">Upload JPG, PNG, WebP photos or PDF deal documents. Max 15 MB per file, up to 12 files per save.</span>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-300">Market visibility</span>
          <select name="visibility" defaultValue={value(deal, 'visibility') || 'private'} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none focus:border-white/30">
            <option value="private">Private / My Deals only</option>
            <option value="team">Team Market</option>
            <option value="community">Community Deals</option>
            <option value="public">Public Deals</option>
          </select>
          <span className="mt-1 block text-xs leading-5 text-slate-500">Controls whether this deal can appear in Market/public/community views. You can keep underwriting private.</span>
        </label>
      </Section>

      <Section title="Property information" description="This is the property profile used for market rent, HUD and per-unit analysis.">
        <Field label="Address" name="address" placeholder="Street address" defaultValue={value(property, 'address')} />
        <Field label="City" name="city" defaultValue={value(property, 'city')} />
        <Field label="State" name="state" placeholder="TX, OH, FL..." defaultValue={value(property, 'state')} />
        <Field label="ZIP code" name="zip_code" defaultValue={value(property, 'zip_code')} />
        <Field label="County" name="county" defaultValue={value(property, 'county')} />
        <label className="block">
          <span className="text-sm font-medium text-slate-300">Property type</span>
          <select name="property_type" defaultValue={value(deal, 'property_type')} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none focus:border-white/30">
            <option value="">Select type</option>
            {propertyTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <Field label="Bedrooms" name="bedrooms" type="number" defaultValue={value(property, 'bedrooms')} />
        <Field label="Bathrooms" name="bathrooms" type="number" defaultValue={value(property, 'bathrooms')} />
        <Field label="Square feet" name="square_feet" type="number" defaultValue={value(property, 'square_feet')} />
        <Field label="Lot size" name="lot_size" defaultValue={value(property, 'lot_size')} />
        <Field label="Year built" name="year_built" type="number" defaultValue={value(property, 'year_built')} />
        <Field label="Number of units" name="number_of_units" type="number" defaultValue={value(property, 'number_of_units') || '1'} />
        <Field label="Occupancy status" name="occupancy_status" placeholder="Vacant, occupied, mixed..." defaultValue={value(property, 'occupancy_status')} />
      </Section>

      <Section title="Purchase, ARV and rehab" description="These inputs power flip, wholesale and BRRRR workflows later.">
        <Field label="Asking price" name="asking_price" type="number" defaultValue={value(deal, 'asking_price')} />
        <Field label="Contract price" name="contract_price" type="number" defaultValue={value(deal, 'contract_price')} />
        <Field label="Purchase price" name="purchase_price" type="number" defaultValue={value(deal, 'purchase_price')} />
        <Field label="ARV" name="arv" type="number" defaultValue={value(deal, 'arv')} />
        <Field label="Rehab estimate" name="rehab_estimate" type="number" defaultValue={value(deal, 'rehab_estimate')} />
      </Section>

      <Section title="Rent assumptions" description="Current, market, HUD and target rent are the base for rent gap and Section 8 analysis.">
        <Field label="Current monthly rent" name="current_rent" type="number" defaultValue={value(deal, 'current_rent')} />
        <Field label="Market monthly rent" name="market_rent" type="number" defaultValue={value(deal, 'market_rent')} />
        <Field label="Section 8 / HUD rent" name="section8_rent" type="number" defaultValue={value(deal, 'section8_rent')} />
        <Field label="Target monthly rent" name="target_rent" type="number" defaultValue={value(deal, 'target_rent')} />
      </Section>

      <Section title="Expenses" description="These inputs feed NOI, cap rate, DSCR, cashflow and break-even rent.">
        <Field label="Annual taxes" name="taxes_annual" type="number" defaultValue={value(deal, 'taxes_annual')} />
        <Field label="Annual insurance" name="insurance_annual" type="number" defaultValue={value(deal, 'insurance_annual')} />
        <Field label="Monthly HOA" name="hoa_monthly" type="number" defaultValue={value(deal, 'hoa_monthly')} />
        <Field label="Monthly utilities" name="utilities_monthly" type="number" defaultValue={value(deal, 'utilities_monthly')} />
        <Field label="Vacancy %" name="vacancy_percent" type="number" defaultValue={value(deal, 'vacancy_percent') || String(defaults?.vacancy_percent ?? '')} />
        <Field label="Management %" name="management_percent" type="number" defaultValue={value(deal, 'management_percent') || String(defaults?.management_percent ?? '')} />
        <Field label="Monthly CapEx reserve" name="capex_monthly" type="number" defaultValue={value(deal, 'capex_monthly') || String(defaults?.capex_monthly ?? '')} />
      </Section>

      <Section title="Financing and strategy assumptions" description="Every major formula uses editable assumptions. Change these when lender terms, market rules or your model differs.">
        <Field label="Down payment %" name="down_payment_percent" type="number" defaultValue={value(deal, 'down_payment_percent') || String(defaults?.down_payment_percent ?? 20)} help="Used when down payment amount is blank." />
        <Field label="Down payment amount" name="down_payment_amount" type="number" defaultValue={value(deal, 'down_payment_amount')} help="Overrides down payment %." />
        <Field label="Loan amount" name="loan_amount" type="number" defaultValue={value(deal, 'loan_amount')} help="Overrides purchase price minus down payment." />
        <Field label="Interest rate %" name="interest_rate_percent" type="number" defaultValue={value(deal, 'interest_rate_percent') || String(defaults?.interest_rate_percent ?? 7)} help="Used in the mortgage payment and DSCR formulas." />
        <Field label="Loan term years" name="loan_term_years" type="number" defaultValue={value(deal, 'loan_term_years') || '30'} help="Reference term shown in the UI." />
        <Field label="Number of monthly payments" name="loan_term_months" type="number" defaultValue={value(deal, 'loan_term_months') || String(defaults?.loan_term_months ?? 360)} help="Actual amortization input. Example: 360 for 30 years, 180 for 15 years." />
        <Field label="DSCR minimum threshold" name="dscr_min_threshold" type="number" defaultValue={value(deal, 'dscr_min_threshold') || String(defaults?.dscr_min_threshold ?? 1.2)} help="Editable per lender/program. Example: 1.20, 1.25 or 1.30." />
        <label className="block">
          <span className="text-sm font-medium text-slate-300">Cap rate basis</span>
          <select name="cap_rate_basis" defaultValue={value(deal, 'cap_rate_basis') || defaults?.cap_rate_basis || 'purchase_price'} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none focus:border-white/30">
            <option value="purchase_price">Purchase price</option>
            <option value="arv">ARV</option>
            <option value="custom_value">Custom value</option>
          </select>
          <span className="mt-1 block text-xs leading-5 text-slate-500">Controls the denominator in the cap rate formula.</span>
        </label>
        <Field label="Custom cap rate value" name="cap_rate_custom_value" type="number" defaultValue={value(deal, 'cap_rate_custom_value')} help="Used only if cap rate basis is custom value." />
        <Field label="Closing costs" name="closing_costs" type="number" defaultValue={value(deal, 'closing_costs')} />
        <Field label="Selling costs %" name="selling_costs_percent" type="number" defaultValue={value(deal, 'selling_costs_percent') || String(defaults?.selling_costs_percent ?? 8)} help="Used in flip profit preview." />
        <Field label="Monthly holding costs" name="holding_costs_monthly" type="number" defaultValue={value(deal, 'holding_costs_monthly') || String(defaults?.holding_costs_monthly ?? '')} help="Used in flip profit preview." />
        <Field label="MAO %" name="mao_percentage" type="number" defaultValue={value(deal, 'mao_percentage') || String(defaults?.mao_percentage ?? 70)} help="Editable wholesale rule. 70% is only a common default, not a law." />
        <Field label="Desired wholesale fee" name="desired_wholesale_fee" type="number" defaultValue={value(deal, 'desired_wholesale_fee') || String(defaults?.desired_wholesale_fee ?? 10000)} />
        <Field label="Refinance LTV %" name="refinance_ltv_percent" type="number" defaultValue={value(deal, 'refinance_ltv_percent') || String(defaults?.refinance_ltv_percent ?? 75)} help="Used in BRRRR refi loan preview." />
        <Field label="Rent growth %" name="rent_growth_percent" type="number" defaultValue={value(deal, 'rent_growth_percent') || String(defaults?.rent_growth_percent ?? 3)} help="Per-deal annual rent-growth assumption for projections/scenarios." />
        <Field label="Expense growth %" name="expense_growth_percent" type="number" defaultValue={value(deal, 'expense_growth_percent') || String(defaults?.expense_growth_percent ?? 3)} help="Per-deal annual expense-growth assumption for projections/scenarios." />
        <Field label="Exit cap rate %" name="exit_cap_rate_percent" type="number" defaultValue={value(deal, 'exit_cap_rate_percent') || String(defaults?.exit_cap_rate_percent ?? 7)} help="Per-deal assumption for future value/projection modules." />
      </Section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
        <label className="block">
          <span className="text-sm font-medium text-slate-300">Notes</span>
          <textarea name="notes" rows={5} defaultValue={value(deal, 'notes')} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-white/30" />
        </label>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button className="rounded-xl bg-white px-5 py-3 font-semibold text-slate-950 transition hover:bg-slate-200">{submitLabel}</button>
        <a href="/deals" className="rounded-xl border border-white/10 px-5 py-3 font-semibold text-slate-100 transition hover:bg-white/10">Cancel</a>
      </div>
    </form>
  )
}
