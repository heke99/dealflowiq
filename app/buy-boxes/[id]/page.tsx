import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { archiveBuyBoxAction, runBuyBoxNowAction, updateBuyBoxAction } from '@/app/buy-boxes/actions'

type Row = Record<string, any>

function dateText(value: string | null | undefined) {
  if (!value) return 'Not scheduled'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

function money(value: number | string | null | undefined) {
  const parsed = Number(value || 0)
  if (!parsed) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(parsed)
}

function Field({ label, name, placeholder, type = 'text', defaultValue }: { label: string; name: string; placeholder?: string; type?: string; defaultValue?: string | number | null }) {
  return <label className="block"><span className="text-sm font-medium text-slate-300">{label}</span><input name={name} type={type} defaultValue={defaultValue ?? ''} placeholder={placeholder} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none placeholder:text-slate-600 focus:border-white/30" /></label>
}

function sourceUrls(value: any) {
  if (Array.isArray(value)) return value.join('\n')
  return ''
}

function listText(value: any) {
  if (Array.isArray(value)) return value.join(', ')
  return ''
}

export default async function BuyBoxDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()
  const { data: buyBox } = await supabase.from('market_buy_boxes').select('*').eq('id', id).maybeSingle()
  if (!buyBox) notFound()
  const row = buyBox as Row

  const [sourcesResult, matchesResult, jobsResult] = await Promise.all([
    supabase.from('market_sources').select('*').eq('buy_box_id', id).order('created_at', { ascending: false }),
    supabase.from('market_buy_box_matches').select('*, market_listings(*)').eq('buy_box_id', id).order('deal_score', { ascending: false }).limit(20),
    supabase.from('market_import_jobs').select('*').eq('organization_id', row.organization_id).order('created_at', { ascending: false }).limit(10),
  ])

  const matches = (matchesResult.data || []) as Row[]

  return (
    <AppShell organizationName={workspace.organization?.name} userEmail={workspace.user.email} accountType={workspace.access.accountType} features={workspace.access.features} subscriptionStatus={workspace.access.status} planName={workspace.access.plan?.name} trialEndsAt={workspace.access.trialEndsAt} isPlatformAdmin={workspace.access.isPlatformAdmin}>
      <div className="space-y-6">
        <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-purple-500/15 via-slate-950 to-black p-6 sm:p-8">
          <Link href="/buy-boxes" className="text-sm text-slate-400 hover:text-white">← Buy Boxes</Link>
          <div className="mt-5 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-sm font-bold uppercase tracking-wide text-purple-300">Buy Box</div>
              <h1 className="mt-2 text-4xl font-black tracking-tight">{row.name}</h1>
              <p className="mt-3 max-w-3xl text-slate-300">{row.description || 'Automated market criteria for finding and ranking deals.'}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <form action={runBuyBoxNowAction}><input type="hidden" name="buy_box_id" value={row.id} /><button className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950">Run now</button></form>
              <Link href="/opportunities" className="rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-slate-100">Opportunities</Link>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-4">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5"><div className="text-xs text-slate-500">Last run</div><div className="mt-1 font-bold">{dateText(row.last_run_at)}</div></div>
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5"><div className="text-xs text-slate-500">Next run</div><div className="mt-1 font-bold">{dateText(row.next_run_at)}</div></div>
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5"><div className="text-xs text-slate-500">Matched</div><div className="mt-1 text-2xl font-black">{row.last_results_count || matches.length || 0}</div></div>
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5"><div className="text-xs text-slate-500">Opportunities</div><div className="mt-1 text-2xl font-black text-emerald-300">{row.last_opportunities_count || matches.filter((m) => Number(m.deal_score || 0) >= Number(row.min_deal_score || 70)).length}</div></div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-6">
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xl font-bold">Criteria</h2>
              <form action={updateBuyBoxAction} className="mt-5 grid gap-4">
                <input type="hidden" name="buy_box_id" value={row.id} />
                <Field label="Name" name="name" defaultValue={row.name} />
                <textarea name="description" rows={2} defaultValue={row.description || ''} className="w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none focus:border-white/30" />
                <div className="grid gap-4 sm:grid-cols-3"><Field label="City" name="city" defaultValue={row.city} /><Field label="State" name="state" defaultValue={row.state} /><Field label="ZIP" name="zip_code" defaultValue={row.zip_code} /></div>
                <Field label="Property types" name="property_types" defaultValue={listText(row.property_types)} />
                <div className="grid gap-4 sm:grid-cols-3"><Field label="Max price" name="max_price" type="number" defaultValue={row.max_price} /><Field label="Min score" name="min_deal_score" type="number" defaultValue={row.min_deal_score || 70} /><Field label="Min rent confidence" name="min_rent_confidence" type="number" defaultValue={row.min_rent_confidence || 50} /></div>
                <div className="grid gap-4 sm:grid-cols-3"><Field label="Min cashflow" name="min_cashflow" type="number" defaultValue={row.min_cashflow} /><Field label="Min DSCR" name="min_dscr" type="number" defaultValue={row.min_dscr} /><Field label="Min HUD gap" name="min_hud_rent_gap" type="number" defaultValue={row.min_hud_rent_gap} /></div>
                <label className="block"><span className="text-sm font-medium text-slate-300">Source URLs</span><textarea name="source_urls" rows={5} defaultValue={sourceUrls(row.source_urls)} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none focus:border-white/30" /></label>
                <div className="grid gap-4 sm:grid-cols-2"><label className="block"><span className="text-sm font-medium text-slate-300">Strategy</span><select name="strategy" defaultValue={row.strategy || 'buy_hold'} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100"><option value="section8">Section 8</option><option value="buy_hold">Buy & Hold</option><option value="brrrr">BRRRR</option><option value="flip">Fix & Flip</option><option value="wholesale">Wholesale</option><option value="commercial">Commercial</option></select></label><label className="block"><span className="text-sm font-medium text-slate-300">Schedule</span><select name="schedule_frequency" defaultValue={row.schedule_frequency || 'daily'} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100"><option value="manual">Manual only</option><option value="hourly">Hourly</option><option value="twice_daily">Twice daily</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label></div>
                <div className="grid gap-2 sm:grid-cols-2"><button className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950">Save changes</button></div>
              </form>
              <form action={archiveBuyBoxAction} className="mt-4"><input type="hidden" name="buy_box_id" value={row.id} /><button className="rounded-xl border border-red-500/30 px-5 py-3 text-sm font-semibold text-red-100 hover:bg-red-500/10">Archive Buy Box</button></form>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xl font-bold">Sources</h2>
              <div className="mt-4 space-y-3">{(sourcesResult.data || []).map((source: Row) => <div key={source.id} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4"><div className="font-semibold">{source.source_name}</div><div className="mt-1 text-xs text-slate-500">{source.source_type} · {source.schedule_frequency} · {source.auto_import_enabled ? 'Auto' : 'Manual'}</div></div>)}{!(sourcesResult.data || []).length ? <p className="text-sm text-slate-500">No sources attached yet.</p> : null}</div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xl font-bold">Matched Listings</h2>
              <div className="mt-5 space-y-3">{matches.map((match) => {
                const listing = match.market_listings as Row
                return <Link key={match.id} href={`/market/${listing.id}`} className="block rounded-2xl border border-white/10 bg-slate-950/40 p-4 hover:bg-white/5"><div className="flex items-center justify-between gap-4"><div><div className="font-semibold">{listing.title || listing.address}</div><div className="mt-1 text-xs text-slate-500">{[listing.city, listing.state, listing.zip_code].filter(Boolean).join(', ')} · {money(listing.list_price || listing.asking_price)}</div></div><div className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-center text-emerald-100"><div className="text-[10px] uppercase">Score</div><div className="text-xl font-bold">{Math.round(Number(match.deal_score || 0))}</div></div></div></Link>
              })}{!matches.length ? <p className="rounded-2xl border border-dashed border-white/15 p-6 text-sm text-slate-500">No matched listings yet. Click Run now after adding URLs or wait for the schedule.</p> : null}</div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xl font-bold">Recent Import Jobs</h2>
              <div className="mt-5 space-y-3">{(jobsResult.data || []).map((job: Row) => <div key={job.id} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4"><div className="flex items-center justify-between"><div className="text-sm font-semibold">{job.job_type?.replaceAll('_', ' ')}</div><span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">{job.status}</span></div><div className="mt-2 text-xs text-slate-500">Created {job.items_created || 0} · Updated {job.items_updated || 0} · Failed {job.items_failed || 0}</div>{job.error_message ? <div className="mt-2 text-xs text-red-200">{job.error_message}</div> : null}</div>)}</div>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  )
}
