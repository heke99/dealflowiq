import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { summarizeMarketRentComps } from '@/lib/underwriting/rentIntelligence'
import { addMarketRentCompAction, applyMarketRentSummaryAction, lookupHudRentAction } from '@/app/deals/[id]/rent-intelligence/actions'

function money(value: unknown) {
  const num = Number(value || 0)
  if (!num) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num)
}

function Stat({ label, value, help }: { label: string; value: React.ReactNode; help?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-bold text-slate-100">{value}</div>
      {help ? <div className="mt-1 text-xs text-slate-500">{help}</div> : null}
    </div>
  )
}

function Field({ label, name, type = 'text', defaultValue, placeholder, help }: { label: string; name: string; type?: string; defaultValue?: string | number | null; placeholder?: string; help?: string }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-300">{label}</span>
      <input name={name} type={type} step={type === 'number' ? '0.01' : undefined} defaultValue={defaultValue ?? ''} placeholder={placeholder} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none placeholder:text-slate-600 focus:border-white/30" />
      {help ? <span className="mt-1 block text-xs leading-5 text-slate-500">{help}</span> : null}
    </label>
  )
}

export default async function DealRentIntelligencePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params
  const query = await searchParams
  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()

  const { data: deal } = workspace.organization?.id
    ? await supabase
        .from('deals')
        .select('*, properties(*)')
        .eq('id', id)
        .eq('organization_id', workspace.organization.id)
        .maybeSingle()
    : { data: null }

  if (!deal) notFound()
  const property = Array.isArray((deal as any).properties) ? (deal as any).properties[0] : (deal as any).properties

  const { data: comps } = workspace.organization?.id
    ? await supabase
        .from('market_rent_comps')
        .select('*')
        .eq('organization_id', workspace.organization.id)
        .eq('deal_id', id)
        .order('created_at', { ascending: false })
    : { data: [] }

  const { data: hudCache } = property?.zip_code
    ? await supabase
        .from('hud_fmr_cache')
        .select('*')
        .eq('zip_code', property.zip_code)
        .order('hud_year', { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null }

  const summary = summarizeMarketRentComps((comps || []) as any)
  const currentRent = Number((deal as any).current_rent || 0)
  const marketRent = Number((deal as any).market_rent || 0)
  const hudRent = Number((deal as any).section8_rent || 0)

  return (
    <AppShell
      organizationName={workspace.organization?.name}
      userEmail={workspace.user.email}
      accountType={workspace.access.accountType}
      features={workspace.access.features}
      subscriptionStatus={workspace.access.status}
      planName={workspace.access.plan?.name}
      trialEndsAt={workspace.access.trialEndsAt}
      isPlatformAdmin={workspace.access.isPlatformAdmin}
    >
      <div className="space-y-6">
        <section className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-8 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Batch 6</div>
            <h1 className="mt-2 text-3xl font-bold">Rent Intelligence</h1>
            <p className="mt-3 max-w-3xl text-slate-300">
              Build market rent from comparable listings and pull Section 8/HUD FMR benchmarks by ZIP. Zillow and similar URLs are stored as source references unless a licensed API is connected.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href={`/deals/${id}/analyzer`} className="rounded-xl bg-white px-5 py-3 text-center font-semibold text-slate-950 hover:bg-slate-200">Analyze</Link>
            <Link href={`/deals/${id}/edit`} className="rounded-xl border border-white/10 px-5 py-3 text-center font-semibold text-slate-100 hover:bg-white/10">Edit Deal</Link>
          </div>
        </section>

        {query?.saved ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">Saved successfully.</div> : null}
        {query?.error ? <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">{String(query.error)}</div> : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Stat label="Current Rent" value={money(currentRent)} />
          <Stat label="Market Rent" value={money(marketRent)} help={summary.count ? `Based on ${summary.count} saved comp(s)` : 'No saved comps yet'} />
          <Stat label="HUD / Section 8 Benchmark" value={money(hudRent)} help={hudCache ? `HUD year ${hudCache.hud_year}` : 'Run HUD lookup'} />
          <Stat label="Rent Confidence" value={`${summary.confidenceScore}/100`} help="Based on comps count, sqft data and manual confidence." />
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <form action={addMarketRentCompAction} className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <input type="hidden" name="deal_id" value={id} />
            <h2 className="text-xl font-bold">Add market rent comp</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Paste a Zillow/listing URL as source evidence, then enter the observed rent. This keeps DealFlowIQ compliant and auditable until licensed market-data APIs are added.
            </p>
            <div className="mt-6 grid gap-5 md:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-slate-300">Source type</span>
                <select name="source_type" defaultValue="manual" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none focus:border-white/30">
                  <option value="manual">Manual comp</option>
                  <option value="zillow_url">Zillow URL</option>
                  <option value="licensed_api">Licensed API</option>
                  <option value="csv_upload">CSV upload</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <Field label="Monthly rent" name="monthly_rent" type="number" />
              <Field label="Source name" name="source_name" placeholder="Zillow, Apartments.com, PM quote..." />
              <Field label="Source URL" name="source_url" placeholder="https://..." />
              <Field label="Comp address" name="comp_address" />
              <Field label="ZIP code" name="zip_code" defaultValue={property?.zip_code || ''} />
              <Field label="Bedrooms" name="bedrooms" type="number" defaultValue={property?.bedrooms || ''} />
              <Field label="Bathrooms" name="bathrooms" type="number" defaultValue={property?.bathrooms || ''} />
              <Field label="Square feet" name="square_feet" type="number" />
              <Field label="Distance miles" name="distance_miles" type="number" />
              <Field label="Listing date" name="listing_date" type="date" />
              <Field label="Confidence 0-100" name="confidence_score" type="number" />
            </div>
            <label className="mt-5 flex items-center gap-3 text-sm text-slate-300">
              <input type="checkbox" name="apply_to_deal" className="h-4 w-4" defaultChecked />
              Apply median/recommended market rent to the deal after saving.
            </label>
            <button className="mt-6 rounded-xl bg-white px-5 py-3 font-semibold text-slate-950 hover:bg-slate-200">Save Comp</button>
          </form>

          <div className="space-y-6">
            <form action={lookupHudRentAction} className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <input type="hidden" name="deal_id" value={id} />
              <h2 className="text-xl font-bold">HUD / Section 8 lookup</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Uses HUD USER FMR/SAFMR-style benchmark data by ZIP/year. Configure <code>HUDUSER_API_TOKEN</code> and optionally <code>HUDUSER_FMR_LOOKUP_URL_TEMPLATE</code> in environment variables.
              </p>
              <div className="mt-6 grid gap-5 md:grid-cols-3">
                <Field label="ZIP code" name="zip_code" defaultValue={property?.zip_code || ''} />
                <Field label="Bedrooms" name="bedrooms" type="number" defaultValue={property?.bedrooms || ''} />
                <Field label="HUD year" name="hud_year" type="number" defaultValue={new Date().getFullYear()} />
              </div>
              <div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100">
                HUD/FMR is a benchmark, not guaranteed contract rent. Final Section 8 rent depends on local PHA payment standards, voucher size, tenant income, utility allowance and inspection approval.
              </div>
              <button className="mt-6 rounded-xl bg-white px-5 py-3 font-semibold text-slate-950 hover:bg-slate-200">Run HUD Lookup</button>
            </form>

            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xl font-bold">Market rent summary</h2>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-slate-900/70 p-3"><dt className="text-slate-500">Low</dt><dd className="font-semibold">{money(summary.lowRent)}</dd></div>
                <div className="rounded-xl border border-white/10 bg-slate-900/70 p-3"><dt className="text-slate-500">Median</dt><dd className="font-semibold">{money(summary.medianRent)}</dd></div>
                <div className="rounded-xl border border-white/10 bg-slate-900/70 p-3"><dt className="text-slate-500">High</dt><dd className="font-semibold">{money(summary.highRent)}</dd></div>
                <div className="rounded-xl border border-white/10 bg-slate-900/70 p-3"><dt className="text-slate-500">Avg $/sqft</dt><dd className="font-semibold">{summary.averageRentPerSqft ? `$${summary.averageRentPerSqft.toFixed(2)}` : '—'}</dd></div>
              </dl>
              <form action={applyMarketRentSummaryAction} className="mt-5">
                <input type="hidden" name="deal_id" value={id} />
                <button className="rounded-xl border border-white/10 px-5 py-3 font-semibold text-slate-100 hover:bg-white/10">Apply Recommended Market Rent</button>
              </form>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-xl font-bold">Saved comps</h2>
          <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
            {(comps || []).length ? (comps || []).map((comp: any) => (
              <div key={comp.id} className="grid gap-3 border-b border-white/10 p-4 last:border-b-0 md:grid-cols-[1fr_0.7fr_0.7fr_0.7fr] md:items-center">
                <div>
                  <div className="font-semibold">{comp.comp_address || comp.source_name || 'Rental comp'}</div>
                  <div className="mt-1 text-xs text-slate-500">{comp.source_type?.replaceAll('_', ' ')} · {comp.source_url ? <a href={comp.source_url} target="_blank" className="text-slate-300 underline">source</a> : 'no source URL'}</div>
                </div>
                <div className="text-sm text-slate-300">{money(comp.monthly_rent)}/mo</div>
                <div className="text-sm text-slate-300">{comp.bedrooms || '—'} bd · {comp.square_feet || '—'} sqft</div>
                <div className="text-sm text-slate-400">Confidence {comp.confidence_score || '—'}</div>
              </div>
            )) : <div className="p-6 text-sm text-slate-500">No comps yet. Add at least three good comps for a more useful market rent confidence score.</div>}
          </div>
        </section>
      </div>
    </AppShell>
  )
}
