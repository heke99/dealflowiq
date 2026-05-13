import type { createDealAction, updateDealAction } from '@/app/deals/actions'

type Action = typeof createDealAction | typeof updateDealAction

type DealFormProps = {
  action: Action
  submitLabel: string
  deal?: Record<string, any> | null
  property?: Record<string, any> | null
  error?: string | null
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

function Field({ label, name, type = 'text', placeholder, defaultValue }: { label: string; name: string; type?: string; placeholder?: string; defaultValue?: string }) {
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

export function DealForm({ action, submitLabel, deal, property, error }: DealFormProps) {
  return (
    <form action={action} className="space-y-6">
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
        <Field label="Vacancy %" name="vacancy_percent" type="number" defaultValue={value(deal, 'vacancy_percent')} />
        <Field label="Management %" name="management_percent" type="number" defaultValue={value(deal, 'management_percent')} />
        <Field label="Monthly CapEx reserve" name="capex_monthly" type="number" defaultValue={value(deal, 'capex_monthly')} />
      </Section>

      <Section title="Financing and strategy assumptions" description="Used by mortgage payment, DSCR, cash-on-cash, flip, wholesale and BRRRR previews.">
        <Field label="Down payment %" name="down_payment_percent" type="number" defaultValue={value(deal, 'down_payment_percent') || '20'} />
        <Field label="Down payment amount" name="down_payment_amount" type="number" defaultValue={value(deal, 'down_payment_amount')} />
        <Field label="Loan amount" name="loan_amount" type="number" defaultValue={value(deal, 'loan_amount')} />
        <Field label="Interest rate %" name="interest_rate_percent" type="number" defaultValue={value(deal, 'interest_rate_percent') || '7'} />
        <Field label="Loan term years" name="loan_term_years" type="number" defaultValue={value(deal, 'loan_term_years') || '30'} />
        <Field label="Closing costs" name="closing_costs" type="number" defaultValue={value(deal, 'closing_costs')} />
        <Field label="Selling costs %" name="selling_costs_percent" type="number" defaultValue={value(deal, 'selling_costs_percent') || '8'} />
        <Field label="Monthly holding costs" name="holding_costs_monthly" type="number" defaultValue={value(deal, 'holding_costs_monthly')} />
        <Field label="Desired wholesale fee" name="desired_wholesale_fee" type="number" defaultValue={value(deal, 'desired_wholesale_fee') || '10000'} />
        <Field label="Refinance LTV %" name="refinance_ltv_percent" type="number" defaultValue={value(deal, 'refinance_ltv_percent') || '75'} />
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
