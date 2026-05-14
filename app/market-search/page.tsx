import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { canUseFeature } from '@/lib/billing/features'
import { createMarketSourceImportAction } from '@/app/market-search/actions'

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-white/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-slate-400">{children}</span>
}

function Field({ label, name, placeholder, defaultValue }: { label: string; name: string; placeholder?: string; defaultValue?: string }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-300">{label}</span>
      <input name={name} defaultValue={defaultValue || ''} placeholder={placeholder} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none placeholder:text-slate-600 focus:border-white/30" />
    </label>
  )
}

export default async function MarketSearchPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams
  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()
  const canImportSources = canUseFeature(workspace.access.features, 'market_source_imports')

  const { data: imports } = workspace.organization?.id
    ? await supabase
        .from('market_source_imports')
        .select('*')
        .eq('organization_id', workspace.organization.id)
        .order('created_at', { ascending: false })
        .limit(10)
    : { data: [] }

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
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Market</div>
              <h1 className="mt-2 text-3xl font-bold">Source imports & deal discovery</h1>
              <p className="mt-3 max-w-3xl text-slate-300">
                Queue authorized sources like Zillow, Crexi, CSV files, or licensed provider feeds. DealFlowIQ stores the source, scores the opportunity, and keeps results in review before they become deals or market comps.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge>Premium import pipeline</Badge>
                <Badge>Review before save</Badge>
                <Badge>HUD + rent intelligence ready</Badge>
              </div>
            </div>
            <Link href="/deals/new" className="rounded-xl bg-white px-5 py-3 text-center font-semibold text-slate-950 transition hover:bg-slate-200">Create Deal</Link>
          </div>
        </section>

        {query?.saved ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">Saved successfully.</div> : null}
        {query?.error ? <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">{String(query.error)}</div> : null}

        <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold">Import market source</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  This is the premium foundation for pulling opportunities from approved sources. For protected portals, use only sources/API access you are authorized to use.
                </p>
              </div>
              {!canImportSources ? <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-100">Locked</span> : null}
            </div>

            {canImportSources ? (
              <form action={createMarketSourceImportAction} className="mt-6 grid gap-5">
                <label className="block">
                  <span className="text-sm font-medium text-slate-300">Source</span>
                  <select name="source_type" defaultValue="zillow" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none focus:border-white/30">
                    <option value="zillow">Zillow</option>
                    <option value="crexi">Crexi</option>
                    <option value="apartments">Apartments.com</option>
                    <option value="realtor">Realtor.com</option>
                    <option value="redfin">Redfin</option>
                    <option value="csv">CSV upload</option>
                    <option value="licensed_api">Licensed API</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <Field label="Source URL" name="source_url" placeholder="https://..." />
                <div className="grid gap-5 md:grid-cols-2">
                  <Field label="Market" name="search_market" placeholder="Tucson, AZ" />
                  <Field label="ZIP" name="search_zip" placeholder="85741" />
                </div>
                <div className="grid gap-5 md:grid-cols-2">
                  <label className="block">
                    <span className="text-sm font-medium text-slate-300">Strategy</span>
                    <select name="strategy" defaultValue="rental" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none focus:border-white/30">
                      <option value="rental">Rental / buy & hold</option>
                      <option value="section8">Section 8 / HUD</option>
                      <option value="brrrr">BRRRR</option>
                      <option value="flip">Fix & flip</option>
                      <option value="wholesale">Wholesale</option>
                      <option value="commercial">Commercial</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-slate-300">Property type</span>
                    <select name="property_type" defaultValue="single_family" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none focus:border-white/30">
                      <option value="single_family">Single family</option>
                      <option value="multifamily">Multifamily</option>
                      <option value="condo">Condo</option>
                      <option value="commercial">Commercial</option>
                      <option value="mixed_use">Mixed use</option>
                    </select>
                  </label>
                </div>
                <Field label="Notes" name="notes" placeholder="Authorization notes, search filters, rent target, min cap rate..." />
                <button className="rounded-xl bg-white px-5 py-3 font-semibold text-slate-950 hover:bg-slate-200">Queue Import</button>
              </form>
            ) : (
              <div className="mt-6 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-5 text-sm leading-6 text-amber-100">
                Market source imports are premium. Manual deals, rent analysis, and basic market comps still work. Upgrade or use an admin feature override to unlock automated source ingestion.
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-xl font-bold">Recent import jobs</h2>
            <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
              {(imports || []).length ? (imports || []).map((item: any) => (
                <div key={item.id} className="grid gap-3 border-b border-white/10 p-4 last:border-b-0 md:grid-cols-[1fr_0.5fr_0.5fr] md:items-center">
                  <div>
                    <div className="font-semibold text-slate-100">{item.search_market || item.search_zip || item.source_url || 'Source import'}</div>
                    <div className="mt-1 text-xs text-slate-500">{String(item.source_type || 'source').replaceAll('_', ' ')} · {item.source_url ? <a href={item.source_url} target="_blank" className="text-slate-300 underline">source</a> : 'no URL'}</div>
                  </div>
                  <div className="text-sm text-slate-300">{String(item.status || 'queued').replaceAll('_', ' ')}</div>
                  <div className="text-sm text-slate-400">{item.imported_count || 0} imported</div>
                </div>
              )) : <div className="p-6 text-sm text-slate-500">No import jobs yet. Queue a source when you are ready to pull opportunities into DealFlowIQ.</div>}
            </div>
            <p className="mt-5 text-xs leading-5 text-slate-500">
              Next implementation step: a background worker can process queued jobs, normalize listings, calculate opportunity scores, and let you approve the best ones into Deals.
            </p>
          </div>
        </section>
      </div>
    </AppShell>
  )
}
