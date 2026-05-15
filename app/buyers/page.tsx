import type { ReactNode } from 'react'
import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { canUseFeature } from '@/lib/billing/features'
import { archiveBuyerAction, createBuyerAction, createBuyerInteractionAction, runBuyerMatchingAction } from '@/app/buyers/actions'

type Row = Record<string, any>
type Search = Record<string, string | string[] | undefined>

const buyerTypes = [
  ['investor', 'Investor'],
  ['landlord', 'Landlord'],
  ['flipper', 'Fix & Flip Buyer'],
  ['wholesaler', 'Wholesaler'],
  ['fund', 'Fund'],
  ['agent', 'Agent'],
  ['other', 'Other'],
]

const statuses = [
  ['active', 'Active'],
  ['warm', 'Warm'],
  ['hot', 'Hot'],
  ['paused', 'Paused'],
  ['archived', 'Archived'],
]

function one(value: string | string[] | undefined, fallback = '') {
  if (Array.isArray(value)) return value[0] || fallback
  return value || fallback
}

function money(value: number | string | null | undefined, compact = false) {
  const parsed = Number(value || 0)
  if (!parsed) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, notation: compact ? 'compact' : 'standard' }).format(parsed)
}

function percent(value: number | string | null | undefined) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || !parsed) return '—'
  return `${(parsed * 100).toFixed(1)}%`
}

function dateText(value: string | null | undefined) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
}

function listText(value: unknown) {
  return Array.isArray(value) && value.length ? value.join(', ') : 'Any'
}

function countByBuyer(matches: Row[] | null | undefined) {
  const map = new Map<string, number>()
  for (const match of matches || []) {
    const buyerId = String(match.buyer_id)
    map.set(buyerId, (map.get(buyerId) || 0) + 1)
  }
  return map
}

function Field({ label, name, type = 'text', placeholder, defaultValue, required }: { label: string; name: string; type?: string; placeholder?: string; defaultValue?: string | number | null; required?: boolean }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-300">{label}</span>
      <input name={name} type={type} required={required} defaultValue={defaultValue ?? ''} placeholder={placeholder} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none placeholder:text-slate-600 focus:border-white/30" />
    </label>
  )
}

function SelectField({ label, name, defaultValue, children }: { label: string; name: string; defaultValue?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-300">{label}</span>
      <select name={name} defaultValue={defaultValue} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none focus:border-white/30">
        {children}
      </select>
    </label>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-2 text-2xl font-black ${tone || 'text-white'}`}>{value}</div>
    </div>
  )
}

function BuyerCard({ buyer, matchCount }: { buyer: Row; matchCount: number }) {
  return (
    <article className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <span>{String(buyer.buyer_type || 'buyer').replaceAll('_', ' ')}</span>
            <span>•</span>
            <span>{String(buyer.relationship_stage || 'new').replaceAll('_', ' ')}</span>
          </div>
          <h3 className="mt-2 truncate text-xl font-bold text-white">{buyer.name}</h3>
          <p className="mt-1 truncate text-sm text-slate-400">{buyer.company_name || buyer.email || buyer.phone || 'Contact details pending'}</p>
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-300">{buyer.status}</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3"><div className="text-xs text-slate-500">Budget</div><div className="font-bold">{money(buyer.min_budget, true)}–{money(buyer.max_budget, true)}</div></div>
        <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3"><div className="text-xs text-slate-500">Matches</div><div className="font-bold text-emerald-300">{matchCount}</div></div>
        <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3"><div className="text-xs text-slate-500">Markets</div><div className="truncate font-bold">{listText(buyer.preferred_states)}</div></div>
        <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3"><div className="text-xs text-slate-500">POF</div><div className="font-bold">{String(buyer.proof_of_funds_status || 'unknown').replaceAll('_', ' ')}</div></div>
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-sm leading-6 text-slate-400">
        <div><span className="text-slate-500">Property:</span> {listText(buyer.property_types)}</div>
        <div><span className="text-slate-500">Strategy:</span> {listText(buyer.strategies)}</div>
        <div><span className="text-slate-500">Min targets:</span> Cashflow {money(buyer.min_cashflow)} · DSCR {buyer.min_dscr || '—'} · Cap {buyer.min_cap_rate ? percent(buyer.min_cap_rate) : '—'}</div>
      </div>

      {buyer.notes ? <p className="mt-4 line-clamp-3 text-sm leading-6 text-slate-400">{buyer.notes}</p> : null}

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <form action={runBuyerMatchingAction}>
          <input type="hidden" name="buyer_id" value={buyer.id} />
          <button className="w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-200">Match now</button>
        </form>
        <form action={archiveBuyerAction}>
          <input type="hidden" name="buyer_id" value={buyer.id} />
          <button className="w-full rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-slate-100 hover:bg-white/10">Archive</button>
        </form>
      </div>

      <form action={createBuyerInteractionAction} className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
        <input type="hidden" name="buyer_id" value={buyer.id} />
        <input type="hidden" name="interaction_type" value="note" />
        <input type="hidden" name="direction" value="internal" />
        <textarea name="summary" rows={2} placeholder="Add quick note / follow-up..." className="w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-white/30" />
        <button className="mt-2 w-full rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-white/10">Save note</button>
      </form>
    </article>
  )
}

function MatchCard({ match }: { match: Row }) {
  const buyer = match.buyers as Row | null
  const listing = match.market_listings as Row | null
  const reasons = Array.isArray(match.reasons) ? match.reasons : []
  const risks = Array.isArray(match.risks) ? match.risks : []
  if (!buyer || !listing) return null

  return (
    <article className="rounded-3xl border border-emerald-400/20 bg-emerald-400/[0.06] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-emerald-300">Buyer match</div>
          <Link href={`/market/${listing.id}`} className="mt-2 block text-lg font-bold text-white hover:underline">{listing.title || listing.address || 'Market listing'}</Link>
          <p className="mt-1 text-sm text-slate-400">{[listing.city, listing.state, listing.zip_code].filter(Boolean).join(', ') || 'Location pending'}</p>
        </div>
        <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-center text-emerald-100">
          <div className="text-[10px] font-bold uppercase tracking-wide">Fit</div>
          <div className="text-2xl font-black">{Math.round(Number(match.match_score || 0))}</div>
        </div>
      </div>
      <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
        <div className="text-sm font-semibold text-white">{buyer.name}{buyer.company_name ? ` · ${buyer.company_name}` : ''}</div>
        <div className="mt-1 text-xs text-slate-500">{buyer.email || buyer.phone || 'Contact pending'} · {String(match.status || 'auto_matched').replaceAll('_', ' ')}</div>
        {reasons.length ? <ul className="mt-3 space-y-1 text-sm leading-6 text-slate-300">{reasons.slice(0, 3).map((reason: string, index: number) => <li key={index}>• {reason}</li>)}</ul> : null}
        {risks.length ? <p className="mt-2 text-xs text-amber-200">Risk: {String(risks[0])}</p> : null}
      </div>
    </article>
  )
}

export default async function BuyersPage({ searchParams }: { searchParams?: Promise<Search> }) {
  const params = await searchParams
  const activeStatus = one(params?.status, 'active')
  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()
  const buyersEnabled = canUseFeature(workspace.access.features, 'buyers') || workspace.access.isPlatformAdmin
  const matchingEnabled = canUseFeature(workspace.access.features, 'buyer_matching') || workspace.access.isPlatformAdmin

  let buyersQuery = supabase
    .from('buyers')
    .select('*')
    .eq('organization_id', workspace.organization?.id || '')
    .order('updated_at', { ascending: false })
    .limit(80)
  if (activeStatus !== 'all') buyersQuery = buyersQuery.eq('status', activeStatus)

  const [buyersResult, matchesResult, interactionsResult] = await Promise.all([
    workspace.organization?.id ? buyersQuery : Promise.resolve({ data: [] as Row[], error: null }),
    workspace.organization?.id
      ? supabase.from('buyer_deal_matches').select('*, buyers(*), market_listings(*)').eq('organization_id', workspace.organization.id).order('match_score', { ascending: false }).limit(30)
      : Promise.resolve({ data: [] as Row[], error: null }),
    workspace.organization?.id
      ? supabase.from('buyer_interactions').select('*, buyers(name)').eq('organization_id', workspace.organization.id).order('created_at', { ascending: false }).limit(10)
      : Promise.resolve({ data: [] as Row[], error: null }),
  ])

  const buyers = (buyersResult.data || []) as Row[]
  const matches = (matchesResult.data || []) as Row[]
  const matchCountMap = countByBuyer(matches)
  const activeBuyers = buyers.filter((buyer) => buyer.status !== 'archived').length
  const hotBuyers = buyers.filter((buyer) => buyer.status === 'hot').length
  const followUps = (interactionsResult.data || []).filter((item: Row) => item.next_follow_up_at).length

  return (
    <AppShell organizationName={workspace.organization?.name} userEmail={workspace.user.email} accountType={workspace.access.accountType} features={workspace.access.features} subscriptionStatus={workspace.access.status} planName={workspace.access.plan?.name} trialEndsAt={workspace.access.trialEndsAt} isPlatformAdmin={workspace.access.isPlatformAdmin}>
      <div className="space-y-6">
        <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-indigo-500/15 via-slate-950 to-black p-6 sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-sm font-bold uppercase tracking-wide text-indigo-300">Disposition engine</div>
              <h1 className="mt-2 text-4xl font-black tracking-tight">Buyers & Matching</h1>
              <p className="mt-3 max-w-3xl text-slate-300">
                Keep buyer demand in one CRM, score opportunities against real buyer criteria, and review the best matches before sending deals.
              </p>
            </div>
            <form action={runBuyerMatchingAction}>
              <button disabled={!matchingEnabled} className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">Run buyer matching</button>
            </form>
          </div>
          {params?.saved ? <div className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">Saved successfully{params.matches ? ` · ${one(params.matches)} matches updated` : ''}.</div> : null}
          {params?.error ? <div className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">{String(params.error)}</div> : null}
          {buyersResult.error ? <div className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">{buyersResult.error.message}</div> : null}
          {!buyersEnabled ? <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">Buyer CRM is locked on this workspace. Enable Buyers or Buyer Matching in the plan/admin settings to save buyers.</div> : null}
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Buyers" value={String(buyers.length)} />
          <Metric label="Active" value={String(activeBuyers)} />
          <Metric label="Hot" value={String(hotBuyers)} tone="text-emerald-300" />
          <Metric label="Open matches" value={String(matches.length)} tone="text-indigo-300" />
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-xl font-bold">Add buyer</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">Use real criteria. The matcher uses these fields to avoid sending irrelevant deals.</p>
            <form action={createBuyerAction} className="mt-6 space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Buyer name" name="name" required placeholder="John Investor" />
                <Field label="Company" name="company_name" placeholder="Optional" />
                <Field label="Email" name="email" type="email" placeholder="buyer@example.com" />
                <Field label="Phone" name="phone" placeholder="+1 ..." />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <SelectField label="Type" name="buyer_type" defaultValue="investor">{buyerTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField>
                <SelectField label="Status" name="status" defaultValue="active">{statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField>
                <SelectField label="Stage" name="relationship_stage" defaultValue="new"><option value="new">New</option><option value="qualified">Qualified</option><option value="sent_deals">Sent deals</option><option value="offer_made">Offer made</option><option value="closed">Closed</option><option value="nurture">Nurture</option></SelectField>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Min budget" name="min_budget" type="number" />
                <Field label="Max budget" name="max_budget" type="number" />
                <SelectField label="Proof of funds" name="proof_of_funds_status" defaultValue="unknown"><option value="unknown">Unknown</option><option value="requested">Requested</option><option value="received">Received</option><option value="verified">Verified</option><option value="expired">Expired</option></SelectField>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="States" name="preferred_states" placeholder="TX, FL, OH" />
                <Field label="Cities" name="preferred_cities" placeholder="Dallas, Tampa" />
                <Field label="ZIP codes" name="preferred_zip_codes" placeholder="75201, 33602" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Property types" name="property_types" placeholder="Duplex, Multifamily, Single Family" />
                <Field label="Strategies" name="strategies" placeholder="Buy & Hold, Section 8, Flip, Wholesale" />
              </div>
              <div className="grid gap-4 sm:grid-cols-4">
                <Field label="Min units" name="min_units" type="number" />
                <Field label="Max units" name="max_units" type="number" />
                <Field label="Min cashflow" name="min_cashflow" type="number" />
                <Field label="Min DSCR" name="min_dscr" type="number" />
              </div>
              <textarea name="notes" rows={3} placeholder="Notes, lending preferences, no-go rules..." className="w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none placeholder:text-slate-600 focus:border-white/30" />
              <button disabled={!buyersEnabled} className="w-full rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50">Save buyer</button>
            </form>
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-bold">Buyer list</h2>
                  <p className="mt-1 text-sm text-slate-500">Filter by status and run matching per buyer.</p>
                </div>
                <nav className="flex max-w-full gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/40 p-2">
                  {['all', 'active', 'warm', 'hot', 'paused', 'archived'].map((status) => <Link key={status} href={`/buyers?status=${status}`} className={`shrink-0 rounded-xl px-3 py-2 text-xs font-semibold ${activeStatus === status ? 'bg-white text-slate-950' : 'text-slate-300 hover:bg-white/10'}`}>{status.replaceAll('_', ' ')}</Link>)}
                </nav>
              </div>
              <div className="mt-5 grid gap-5 lg:grid-cols-2">
                {buyers.map((buyer) => <BuyerCard key={buyer.id} buyer={buyer} matchCount={matchCountMap.get(String(buyer.id)) || 0} />)}
                {!buyers.length ? <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-slate-500 lg:col-span-2">No buyers in this status yet. Add your first buyer to start matching opportunities.</div> : null}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1fr_360px]">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold">Best buyer matches</h2>
                <p className="mt-1 text-sm text-slate-500">Review before sending. This is intentionally not auto-emailing buyers yet.</p>
              </div>
              <Link href="/opportunities" className="rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-slate-100 hover:bg-white/10">Opportunities</Link>
            </div>
            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              {matches.map((match) => <MatchCard key={match.id} match={match} />)}
              {!matches.length ? <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-slate-500 lg:col-span-2">No buyer matches yet. Add buyers, make sure Market has scored listings, then click Run buyer matching.</div> : null}
            </div>
          </div>

          <aside className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-xl font-bold">Recent notes</h2>
            <div className="mt-5 space-y-3">
              {(interactionsResult.data || []).map((item: Row) => (
                <div key={item.id} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                  <div className="text-sm font-semibold text-white">{item.buyers?.name || 'Buyer'}</div>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{item.summary}</p>
                  <div className="mt-2 text-xs text-slate-500">{dateText(item.created_at)}{item.next_follow_up_at ? ` · Follow-up ${dateText(item.next_follow_up_at)}` : ''}</div>
                </div>
              ))}
              {!(interactionsResult.data || []).length ? <p className="text-sm text-slate-500">No notes yet. Add a quick note from a buyer card.</p> : null}
            </div>
            <div className="mt-5 rounded-2xl border border-indigo-400/20 bg-indigo-400/10 p-4 text-sm text-indigo-100">
              <div className="font-semibold">Production rule</div>
              <p className="mt-2 leading-6 text-indigo-100/80">Buyer matching creates reviewable matches only. Sending deals to buyers should stay manual until email templates, consent and unsubscribe handling are added.</p>
              <p className="mt-2 text-xs text-indigo-100/70">Open follow-ups: {followUps}</p>
            </div>
          </aside>
        </section>
      </div>
    </AppShell>
  )
}
