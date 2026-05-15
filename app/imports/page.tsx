import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { analyzeImportUrlAction, generateImportPreviewAction, importPreviewItemsAction, runProviderCleanupAction, skipPreviewItemsAction, updateImportBatchStatusAction } from '@/app/imports/actions'

type Row = Record<string, any>
type Search = Record<string, string | string[] | undefined>

function one(value: string | string[] | undefined, fallback = '') {
  if (Array.isArray(value)) return value[0] || fallback
  return value || fallback
}

function money(value: number | string | null | undefined) {
  const parsed = Number(value || 0)
  if (!parsed) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(parsed)
}

function dateText(value?: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

function statusTone(status: string) {
  if (status === 'completed') return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
  if (status === 'failed' || status === 'cancelled') return 'border-red-400/30 bg-red-400/10 text-red-100'
  if (status === 'queued' || status === 'importing') return 'border-sky-400/30 bg-sky-400/10 text-sky-100'
  return 'border-amber-400/30 bg-amber-400/10 text-amber-100'
}

function BatchCard({ batch, selected }: { batch: Row; selected: boolean }) {
  const location = [batch.target_city, batch.target_state, batch.target_zip].filter(Boolean).join(', ') || 'Location pending'
  return (
    <article className={`rounded-3xl border p-5 ${selected ? 'border-emerald-400/40 bg-emerald-400/[0.08]' : 'border-white/10 bg-white/[0.035]'}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(String(batch.status))}`}>{String(batch.status).replaceAll('_', ' ')}</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-300">{batch.source_type}</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-300">{String(batch.import_mode).replaceAll('_', ' ')}</span>
          </div>
          <h2 className="mt-3 text-xl font-bold text-white">{batch.source_name || batch.title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{batch.summary || 'URL analyzed and ready for controlled import workflow.'}</p>
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
            <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3"><div className="text-xs text-slate-500">Location</div><div className="mt-1 font-semibold">{location}</div></div>
            <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3"><div className="text-xs text-slate-500">Max price</div><div className="mt-1 font-semibold">{money(batch.max_price)}</div></div>
            <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3"><div className="text-xs text-slate-500">Visibility</div><div className="mt-1 font-semibold capitalize">{batch.visibility}</div></div>
            <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3"><div className="text-xs text-slate-500">Created</div><div className="mt-1 font-semibold">{dateText(batch.created_at)}</div></div>
          </div>
          <div className="mt-4 truncate text-xs text-slate-600">{batch.normalized_url || batch.input_url}</div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 lg:flex-col">
          <form action={generateImportPreviewAction}>
            <input type="hidden" name="batch_id" value={batch.id} />
            <button className="w-full rounded-xl bg-emerald-300 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-200">Generate preview</button>
          </form>
          <form action={importPreviewItemsAction}>
            <input type="hidden" name="batch_id" value={batch.id} />
            <input type="hidden" name="import_first_10" value="true" />
            <button className="w-full rounded-xl border border-emerald-400/30 px-4 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-400/10">Import first 10</button>
          </form>
          <form action={updateImportBatchStatusAction}>
            <input type="hidden" name="batch_id" value={batch.id} />
            <input type="hidden" name="status" value="needs_review" />
            <button className="w-full rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-white/10">Needs review</button>
          </form>
          <form action={updateImportBatchStatusAction}>
            <input type="hidden" name="batch_id" value={batch.id} />
            <input type="hidden" name="status" value="completed" />
            <button className="w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-slate-200">Mark completed</button>
          </form>
        </div>
      </div>
    </article>
  )
}

export default async function ImportsPage({ searchParams }: { searchParams?: Promise<Search> }) {
  const params = await searchParams
  const selectedBatchId = one(params?.batch)
  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()

  const [{ data: batches, error }, { data: jobs }, { data: previewItems }, { data: auditEvents }, { data: expiringListings }, { data: policies }] = workspace.organization?.id
    ? await Promise.all([
        supabase.from('market_url_import_batches').select('*').eq('organization_id', workspace.organization.id).order('created_at', { ascending: false }).limit(50),
        supabase.from('market_import_jobs').select('*').eq('organization_id', workspace.organization.id).order('created_at', { ascending: false }).limit(8),
        selectedBatchId ? supabase.from('market_import_preview_items').select('*').eq('organization_id', workspace.organization.id).eq('import_batch_id', selectedBatchId).order('created_at', { ascending: true }).limit(25) : Promise.resolve({ data: [] as Row[] }),
        selectedBatchId ? supabase.from('market_import_audit_events').select('*').eq('organization_id', workspace.organization.id).eq('import_batch_id', selectedBatchId).order('created_at', { ascending: false }).limit(12) : Promise.resolve({ data: [] as Row[] }),
        supabase.from('market_listings').select('id,title,source_type,provider_data_expires_at').eq('organization_id', workspace.organization.id).is('provider_data_expired_at', null).not('provider_data_expires_at', 'is', null).order('provider_data_expires_at', { ascending: true }).limit(8),
        supabase.from('market_provider_policies').select('*').or(`organization_id.eq.${workspace.organization.id},organization_id.is.null`).order('source_type', { ascending: true }).limit(20),
      ])
    : [{ data: [] as Row[], error: null }, { data: [] as Row[] }, { data: [] as Row[] }, { data: [] as Row[] }, { data: [] as Row[] }, { data: [] as Row[] }]

  const rows = (batches || []) as Row[]
  const queued = rows.filter((row) => ['queued', 'analyzed', 'importing'].includes(String(row.status))).length
  const completed = rows.filter((row) => row.status === 'completed').length
  const review = rows.filter((row) => row.status === 'needs_review').length
  const previewRows = (previewItems || []) as Row[]
  const auditRows = (auditEvents || []) as Row[]
  const expiringRows = (expiringListings || []) as Row[]
  const policyRows = (policies || []) as Row[]

  return (
    <AppShell organizationName={workspace.organization?.name} userEmail={workspace.user.email} accountType={workspace.access.accountType} features={workspace.access.features} subscriptionStatus={workspace.access.status} planName={workspace.access.plan?.name} trialEndsAt={workspace.access.trialEndsAt} isPlatformAdmin={workspace.access.isPlatformAdmin}>
      <div className="space-y-6">
        <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900 via-slate-950 to-black p-6 sm:p-8">
          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
            <div>
              <div className="text-sm font-bold uppercase tracking-wide text-emerald-300">Batch 12I.2 · Real provider import workflow</div>
              <h1 className="mt-2 text-4xl font-black tracking-tight">URL Import Analyzer</h1>
              <p className="mt-3 max-w-3xl text-slate-300">Paste authorized provider URLs. Search URLs generate a real preview first, then selected listings are imported under provider policy, rate limits and retention rules. No demo import mode, no email/SMS.</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><div className="text-xs text-slate-500">Queued</div><div className="mt-1 text-2xl font-black">{queued}</div></div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><div className="text-xs text-slate-500">Review</div><div className="mt-1 text-2xl font-black">{review}</div></div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><div className="text-xs text-slate-500">Done</div><div className="mt-1 text-2xl font-black">{completed}</div></div>
            </div>
          </div>
          {params?.saved ? <div className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">Saved successfully.</div> : null}
          {params?.error ? <div className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">{String(params.error)}</div> : null}
          {error ? <div className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">{error.message}</div> : null}
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-6">
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xl font-bold">Analyze a source URL</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">This creates an auditable import batch. Use Generate preview to read eligible listings under the configured provider policy before anything is saved as a market listing.</p>
              <form action={analyzeImportUrlAction} className="mt-5 space-y-4">
                <label className="block">
                  <span className="text-sm font-medium text-slate-300">URL</span>
                  <textarea name="input_url" rows={5} placeholder="https://www.zillow.com/johnstown-oh-43031/?searchQueryState=..." className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-white/30" />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-300">Source name</span>
                  <input name="source_name" placeholder="Johnstown OH Zillow ≤ $375k" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none placeholder:text-slate-600 focus:border-white/30" />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-300">Default visibility</span>
                  <select name="visibility" defaultValue="private" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none focus:border-white/30">
                    <option value="private">Private</option>
                    <option value="team">Team</option>
                    <option value="community">Community</option>
                    <option value="public">Public</option>
                  </select>
                </label>
                <button className="w-full rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-200">Analyze and queue</button>
              </form>
            </div>


            {selectedBatchId ? (
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
                <h2 className="text-xl font-bold">Import preview</h2>
                <p className="mt-2 text-sm text-slate-400">Preview rows are real provider-derived candidates. Select the rows you want to import. There is no demo import mode.</p>
                <form action={importPreviewItemsAction} className="mt-5 space-y-3">
                  <input type="hidden" name="batch_id" value={selectedBatchId} />
                  {previewRows.map((item) => (
                    <label key={item.id} className="flex gap-3 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                      <input type="checkbox" name="preview_item_id" value={item.id} disabled={['imported','ignored','failed'].includes(String(item.status))} className="mt-1" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2"><span className={`rounded-full border px-2 py-0.5 text-xs ${statusTone(String(item.status))}`}>{String(item.status).replaceAll('_', ' ')}</span><span className="text-xs text-slate-500">{item.source_type}</span></div>
                        <div className="mt-2 font-semibold text-white">{item.title || item.address || item.source_url}</div>
                        <div className="mt-1 text-sm text-slate-400">{[item.address, item.city, item.state, item.zip_code].filter(Boolean).join(', ') || 'Location pending'} · {money(item.price)} · {item.bedrooms || '—'} bd / {item.bathrooms || '—'} ba · {item.sqft ? `${Number(item.sqft).toLocaleString()} sqft` : 'sqft pending'}</div>
                        {item.ignore_reason ? <div className="mt-2 text-xs text-amber-200">Ignored previously — {String(item.ignore_reason).replaceAll('_', ' ')}</div> : null}
                        {item.error_message ? <div className="mt-2 text-xs text-red-200">{item.error_message}</div> : null}
                        <div className="mt-2 truncate text-xs text-slate-600">{item.source_url}</div>
                      </div>
                    </label>
                  ))}
                  {previewRows.length ? <div className="flex flex-wrap gap-2"><button className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-200">Import selected</button><button formAction={skipPreviewItemsAction} className="rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-slate-100 hover:bg-white/10">Skip selected</button></div> : <div className="rounded-2xl border border-dashed border-white/15 p-5 text-sm text-slate-500">No preview generated yet. Click Generate preview on the selected batch.</div>}
                </form>
              </div>
            ) : null}

            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-bold">Retention cleanup</h2><p className="mt-2 text-sm text-slate-400">Provider data is cleaned after its policy retention period. DealFlowIQ analysis, scores, notes and source links stay.</p></div><form action={runProviderCleanupAction}><button className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-white/10">Run cleanup now</button></form></div>
              <div className="mt-5 space-y-2">
                {expiringRows.map((row) => <Link key={row.id} href={`/market/${row.id}`} className="block rounded-2xl border border-white/10 bg-slate-950/40 p-3 text-sm hover:bg-white/5"><span className="font-semibold text-white">{row.title}</span><span className="ml-2 text-xs text-slate-500">expires {dateText(row.provider_data_expires_at)}</span></Link>)}
                {!expiringRows.length ? <div className="rounded-2xl border border-dashed border-white/15 p-4 text-sm text-slate-500">No provider data expiring soon.</div> : null}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xl font-bold">Provider policies</h2>
              <div className="mt-5 space-y-2">
                {policyRows.map((policy) => <div key={`${policy.organization_id || 'global'}-${policy.source_type}`} className="rounded-2xl border border-white/10 bg-slate-950/40 p-3"><div className="flex items-center justify-between gap-3"><div className="font-semibold capitalize">{policy.provider_label || policy.source_type}</div><span className={policy.is_active ? 'text-xs text-emerald-300' : 'text-xs text-slate-500'}>{policy.is_active ? 'active' : 'inactive'}</span></div><div className="mt-1 text-xs text-slate-500">{policy.max_listings_per_hour || 0}/hour · {policy.storage_days || 15} day retention · search {policy.search_import_allowed ? 'on' : 'off'}</div></div>)}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xl font-bold">Recent real import jobs</h2>
              <div className="mt-5 space-y-3">
                {((jobs || []) as Row[]).map((job) => (
                  <div key={job.id} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                    <div className="flex items-center justify-between gap-3"><div className="text-sm font-semibold capitalize">{String(job.job_type).replaceAll('_', ' ')}</div><span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(String(job.status))}`}>{job.status}</span></div>
                    <div className="mt-2 text-xs text-slate-500">{dateText(job.created_at)} · created {job.items_created || 0} · updated {job.items_updated || 0} · failed {job.items_failed || 0}</div>
                    {job.error_message ? <div className="mt-2 text-xs text-red-200">{job.error_message}</div> : null}
                  </div>
                ))}
                {!((jobs || []) as Row[]).length ? <div className="rounded-2xl border border-dashed border-white/15 p-5 text-sm text-slate-500">No import jobs yet.</div> : null}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {selectedBatchId ? <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6"><h2 className="text-xl font-bold">Import audit log</h2><div className="mt-4 space-y-2">{auditRows.map((event) => <div key={event.id} className="rounded-2xl border border-white/10 bg-slate-950/40 p-3"><div className="text-sm font-semibold text-white">{String(event.event_type).replaceAll('_', ' ')}</div><div className="mt-1 text-xs text-slate-500">{dateText(event.created_at)}</div><p className="mt-2 text-sm text-slate-400">{event.message}</p></div>)}{!auditRows.length ? <div className="rounded-2xl border border-dashed border-white/15 p-4 text-sm text-slate-500">No audit events yet.</div> : null}</div></div> : null}
            {rows.map((batch) => <BatchCard key={batch.id} batch={batch} selected={batch.id === selectedBatchId} />)}
            {!rows.length ? <div className="rounded-3xl border border-dashed border-white/15 bg-white/[0.03] p-10 text-center"><h2 className="text-xl font-bold">No URL batches yet</h2><p className="mt-2 text-slate-400">Paste a Zillow/Redfin/Realtor or feed URL to create your first controlled import batch.</p></div> : null}
          </div>
        </section>
      </div>
    </AppShell>
  )
}
