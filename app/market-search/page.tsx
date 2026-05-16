import Link from 'next/link'
import { OPPORTUNITY_SCORE_THRESHOLD } from '@/lib/market/opportunityRules'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { canUseFeature } from '@/lib/billing/features'
import { importMarketUrlAction } from '@/app/market/actions'
import { SubmitButton } from '@/components/forms/SubmitButton'

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

function dateText(value: string | null | undefined) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

function money(value: number | string | null | undefined, compact = false) {
  const parsed = Number(value || 0)
  if (!parsed) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, notation: compact ? 'compact' : 'standard' }).format(parsed)
}

type Row = Record<string, any>

export default async function MarketSearchPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams
  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()
  const canImportSources = canUseFeature(workspace.access.features, 'market_source_imports') || Boolean(workspace.access.isPlatformAdmin)

  const { data: jobs } = workspace.organization?.id
    ? await supabase
        .from('market_import_jobs')
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
                Paste an authorized listing URL or search URL. DealFlowIQ imports up to the allowed provider limit, scores the listings, and keeps anything below 80 in Market instead of incorrectly sending it to Opportunities.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge>Live import</Badge>
                <Badge>10 listings / hour policy</Badge>
                <Badge>Market first</Badge>
              </div>
            </div>
            <Link href="/market?tab=sources" className="rounded-xl border border-white/10 px-5 py-3 text-center font-semibold text-slate-100 transition hover:bg-white/10">Open full import center</Link>
          </div>
        </section>

        {query?.saved ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">Import completed.</div> : null}
        {query?.error ? <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">{String(query.error)}</div> : null}

        <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold">Import URL now</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Use this for direct listing URLs and search URLs. The button shows loading while the import runs so it does not look broken.
                </p>
              </div>
              {!canImportSources ? <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-100">Locked</span> : null}
            </div>

            {canImportSources ? (
              <form action={importMarketUrlAction} className="mt-6 grid gap-5">
                <label className="block">
                  <span className="text-sm font-medium text-slate-300">Source</span>
                  <select name="source_type" defaultValue="manual_url" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none focus:border-white/30">
                    <option value="manual_url">Auto-detect from URL</option>
                    <option value="zillow">Zillow</option>
                    <option value="crexi">Crexi</option>
                    <option value="loopnet">LoopNet</option>
                    <option value="realtor">Realtor.com</option>
                    <option value="redfin">Redfin</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <Field label="Source URL" name="input_url" placeholder="https://www.zillow.com/homedetails/... or search URL" />
                <label className="block">
                  <span className="text-sm font-medium text-slate-300">Visibility</span>
                  <select name="visibility" defaultValue="private" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none focus:border-white/30">
                    <option value="private">Private</option>
                    <option value="team">Team Market</option>
                    <option value="community">Community</option>
                    <option value="public">Public</option>
                  </select>
                </label>
                <SubmitButton pendingText="Importing listings..." className="rounded-xl bg-white px-5 py-3 font-semibold text-slate-950 hover:bg-slate-200">Import listing/search URL</SubmitButton>
              </form>
            ) : (
              <div className="mt-6 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-5 text-sm leading-6 text-amber-100">
                Market source imports are premium. Manual deals, rent analysis, and basic market comps still work.
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-xl font-bold">Recent import jobs</h2>
            <div className="mt-5 space-y-3">
              {(jobs || []).length ? (jobs || []).map((job: Row) => {
                const summary = (job.source_summary && typeof job.source_summary === 'object' ? job.source_summary : {}) as Row
                const previewRows = Array.isArray(summary.previewRows) ? summary.previewRows : []
                const listingIds = Array.isArray(job.normalized_listing_ids) ? job.normalized_listing_ids : []
                return (
                  <div key={job.id} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-100">{String(job.job_type || 'import').replaceAll('_', ' ')}</div>
                        <div className="mt-1 truncate text-xs text-slate-500">{job.input_url || 'No input URL'}</div>
                      </div>
                      <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${job.status === 'completed' ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100' : job.status === 'failed' ? 'border-red-400/30 bg-red-400/10 text-red-100' : 'border-amber-400/30 bg-amber-400/10 text-amber-100'}`}>{job.status}</span>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-4">
                      <div>Found: {job.items_found || 0}</div>
                      <div>Created: {job.items_created || 0}</div>
                      <div>Updated: {job.items_updated || 0}</div>
                      <div>Failed: {job.items_failed || 0}</div>
                    </div>
                    {summary.topScore !== undefined ? <div className="mt-2 text-xs text-slate-400">Top score: <span className="font-semibold text-slate-100">{Number(summary.topScore || 0)}</span>{Number(summary.topScore || 0) >= OPPORTUNITY_SCORE_THRESHOLD ? ' · qualifies for Opportunities' : ' · visible in Market'}</div> : null}
                    {job.error_message ? <div className="mt-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-100">{job.error_message}</div> : null}
                    {previewRows.length ? (
                      <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
                        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Preview / imported rows</div>
                        <div className="mt-2 space-y-2">
                          {previewRows.slice(0, 10).map((row: Row, index: number) => (
                            <div key={index} className="rounded-lg border border-white/10 bg-white/[0.03] p-2 text-xs">
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate font-medium text-slate-200">{row.address || row.title || row.source_url || `Row ${index + 1}`}</span>
                                <span className={`shrink-0 rounded-full border px-2 py-0.5 ${row.status === 'failed' ? 'border-red-400/30 text-red-200' : 'border-emerald-400/30 text-emerald-200'}`}>{String(row.status || 'ready')}</span>
                              </div>
                              <div className="mt-1 text-slate-500">{[row.city, row.state, row.zip_code].filter(Boolean).join(', ')} · {row.list_price ? money(row.list_price as any, true) : 'price pending'} · {row.bedrooms || '—'} bd / {row.bathrooms || '—'} ba</div>
                              {row.error ? <div className="mt-1 text-red-200">{String(row.error)}</div> : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {listingIds.length ? <Link href={`/market?tab=all&import_job_id=${job.id}`} className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-slate-200">View imported listings in Market</Link> : null}
                      {Number(summary.topScore || 0) >= OPPORTUNITY_SCORE_THRESHOLD ? <Link href="/opportunities" className="rounded-xl border border-emerald-400/30 px-3 py-2 text-xs font-semibold text-emerald-100 hover:bg-emerald-400/10">View Opportunities</Link> : null}
                    </div>
                    <div className="mt-2 text-xs text-slate-500">Created {dateText(job.created_at)}</div>
                  </div>
                )
              }) : <div className="p-6 text-sm text-slate-500">No import jobs yet. Import a listing or search URL to see batch status, preview rows, created/updated counts and links to Market.</div>}
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  )
}
