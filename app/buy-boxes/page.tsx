import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createBuyBoxAction, runBuyBoxNowAction, archiveBuyBoxAction } from '@/app/buy-boxes/actions'

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

function Field({ label, name, placeholder, type = 'text', defaultValue }: { label: string; name: string; placeholder?: string; type?: string; defaultValue?: string }) {
  return <label className="block"><span className="text-sm font-medium text-slate-300">{label}</span><input name={name} type={type} defaultValue={defaultValue} placeholder={placeholder} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none placeholder:text-slate-600 focus:border-white/30" /></label>
}

function BuyBoxCard({ buyBox }: { buyBox: Row }) {
  return (
    <article className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 transition hover:border-white/20 hover:bg-white/[0.055]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href={`/buy-boxes/${buyBox.id}`} className="text-xl font-bold hover:underline">{buyBox.name}</Link>
          <p className="mt-1 text-sm text-slate-400">{[buyBox.city, buyBox.state, buyBox.zip_code].filter(Boolean).join(', ') || 'Any selected market'}</p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${buyBox.status === 'active' ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100' : 'border-white/10 bg-white/5 text-slate-300'}`}>{buyBox.status}</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3"><div className="text-xs text-slate-500">Min score</div><div className="font-bold">{buyBox.min_deal_score || 70}</div></div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3"><div className="text-xs text-slate-500">Rent confidence</div><div className="font-bold">{buyBox.min_rent_confidence || 50}+</div></div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3"><div className="text-xs text-slate-500">Last found</div><div className="font-bold">{buyBox.last_results_count || 0}</div></div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3"><div className="text-xs text-slate-500">Opportunities</div><div className="font-bold text-emerald-300">{buyBox.last_opportunities_count || 0}</div></div>
      </div>
      <div className="mt-4 text-xs text-slate-500">Next run: {dateText(buyBox.next_run_at)}</div>
      {buyBox.last_error ? <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-100">{buyBox.last_error}</div> : null}
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <form action={runBuyBoxNowAction}><input type="hidden" name="buy_box_id" value={buyBox.id} /><button className="w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-950">Run now</button></form>
        <Link href={`/buy-boxes/${buyBox.id}`} className="rounded-xl border border-white/10 px-4 py-3 text-center text-sm font-semibold text-slate-100">Details</Link>
        <form action={archiveBuyBoxAction}><input type="hidden" name="buy_box_id" value={buyBox.id} /><button className="w-full rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-slate-100">Archive</button></form>
      </div>
    </article>
  )
}

export default async function BuyBoxesPage() {
  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()
  const [{ data: buyBoxes }, { count: opportunityCount }, { count: sourceCount }] = workspace.organization?.id
    ? await Promise.all([
        supabase.from('market_buy_boxes').select('*').eq('organization_id', workspace.organization.id).neq('status', 'archived').order('created_at', { ascending: false }),
        supabase.from('market_listing_scores').select('id', { count: 'exact', head: true }).gte('deal_score', 70),
        supabase.from('market_sources').select('id', { count: 'exact', head: true }).eq('organization_id', workspace.organization.id).eq('auto_import_enabled', true),
      ])
    : [{ data: [] as Row[] }, { count: 0 }, { count: 0 }]

  return (
    <AppShell organizationName={workspace.organization?.name} userEmail={workspace.user.email} accountType={workspace.access.accountType} features={workspace.access.features} subscriptionStatus={workspace.access.status} planName={workspace.access.plan?.name} trialEndsAt={workspace.access.trialEndsAt} isPlatformAdmin={workspace.access.isPlatformAdmin}>
      <div className="space-y-6">
        <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-purple-500/15 via-slate-950 to-black p-6 sm:p-8">
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
            <div>
              <div className="text-sm font-bold uppercase tracking-wide text-purple-300">Automated deal discovery</div>
              <h1 className="mt-2 text-4xl font-black tracking-tight">Buy Boxes</h1>
              <p className="mt-3 max-w-3xl text-slate-300">Tell DealFlowIQ what you want. The worker searches authorized sources, imports listings into Market, and pushes high-score deals into Opportunities.</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><div className="text-xs text-slate-500">Buy boxes</div><div className="text-2xl font-black">{(buyBoxes || []).length}</div></div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><div className="text-xs text-slate-500">Auto sources</div><div className="text-2xl font-black">{sourceCount || 0}</div></div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><div className="text-xs text-slate-500">70+ deals</div><div className="text-2xl font-black text-emerald-300">{opportunityCount || 0}</div></div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-xl font-bold">Create Buy Box</h2>
            <p className="mt-2 text-sm text-slate-400">Start with your market, criteria and authorized listing URLs/feed URLs. Later we can add search-page adapters and provider APIs.</p>
            <form action={createBuyBoxAction} className="mt-5 grid gap-4">
              <Field label="Name" name="name" placeholder="Tucson Section 8 Duplex" />
              <textarea name="description" rows={2} placeholder="What should this buy box find?" className="w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none placeholder:text-slate-600 focus:border-white/30" />
              <div className="grid gap-4 sm:grid-cols-3"><Field label="City" name="city" placeholder="Tucson" /><Field label="State" name="state" placeholder="AZ" /><Field label="ZIP" name="zip_code" placeholder="85741" /></div>
              <Field label="Property types" name="property_types" placeholder="Duplex, Triplex, Fourplex" />
              <div className="grid gap-4 sm:grid-cols-3"><Field label="Max price" name="max_price" type="number" placeholder="500000" /><Field label="Min score" name="min_deal_score" type="number" defaultValue="70" /><Field label="Min rent confidence" name="min_rent_confidence" type="number" defaultValue="50" /></div>
              <div className="grid gap-4 sm:grid-cols-3"><Field label="Min cashflow" name="min_cashflow" type="number" placeholder="250" /><Field label="Min DSCR" name="min_dscr" type="number" placeholder="1.2" /><Field label="Min HUD gap" name="min_hud_rent_gap" type="number" placeholder="300" /></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block"><span className="text-sm font-medium text-slate-300">Strategy</span><select name="strategy" defaultValue="section8" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100"><option value="section8">Section 8</option><option value="buy_hold">Buy & Hold</option><option value="brrrr">BRRRR</option><option value="flip">Fix & Flip</option><option value="wholesale">Wholesale</option><option value="commercial">Commercial</option></select></label>
                <label className="block"><span className="text-sm font-medium text-slate-300">Schedule</span><select name="schedule_frequency" defaultValue="hourly" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100"><option value="manual">Manual only</option><option value="hourly">Hourly</option><option value="twice_daily">Twice daily</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label>
              </div>
              <label className="block"><span className="text-sm font-medium text-slate-300">Authorized listing/feed URLs</span><textarea name="source_urls" rows={5} placeholder="One URL per line" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none placeholder:text-slate-600 focus:border-white/30" /></label>
              <div className="grid gap-4 sm:grid-cols-2"><label className="block"><span className="text-sm font-medium text-slate-300">Main source type</span><select name="source_type" defaultValue="zillow" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100"><option value="zillow">Zillow</option><option value="crexi">Crexi</option><option value="loopnet">LoopNet</option><option value="redfin">Redfin</option><option value="realtor">Realtor</option><option value="apartments">Apartments.com</option><option value="manual_url">Manual URL</option><option value="other">Other</option></select></label><Field label="Max URLs per run" name="max_urls_per_run" type="number" defaultValue="10" /></div>
              <button className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-200">Create Buy Box</button>
            </form>
          </div>

          <div className="space-y-4">
            {(buyBoxes || []).map((buyBox: Row) => <BuyBoxCard key={buyBox.id} buyBox={buyBox} />)}
            {!(buyBoxes || []).length ? <div className="rounded-3xl border border-dashed border-white/15 bg-white/[0.03] p-10 text-center"><h2 className="text-xl font-bold">No Buy Boxes yet</h2><p className="mt-2 text-slate-400">Create your first buy box so DealFlowIQ can start searching automatically.</p></div> : null}
          </div>
        </section>
      </div>
    </AppShell>
  )
}
