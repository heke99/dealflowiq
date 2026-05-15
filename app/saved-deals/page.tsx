import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { convertListingToDealAction, saveOpportunityAction, updateMarketListingReviewStatusAction } from '@/app/market/actions'
import { dealStatusLabel } from '@/lib/market/review'

type Row = Record<string, any>

type Search = Record<string, string | string[] | undefined>

const statuses = [
  ['all', 'All'],
  ['saved', 'Saved'],
  ['watching', 'Watching'],
  ['interested', 'Interested'],
  ['contacted', 'Contacted'],
  ['analyzing', 'Analyzing'],
  ['converted_to_deal', 'Converted'],
  ['ignored', 'Ignored'],
  ['passed', 'Passed'],
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

function latestScoreMap(scores: Row[] | null | undefined) {
  const map = new Map<string, Row>()
  for (const score of scores || []) if (!map.has(String(score.listing_id))) map.set(String(score.listing_id), score)
  return map
}

function percent(value: number | string | null | undefined) {
  const parsed = Number(value || 0)
  if (!parsed) return '—'
  return `${parsed.toFixed(parsed >= 10 ? 0 : 1)}%`
}

function ratio(value: number | string | null | undefined) {
  const parsed = Number(value || 0)
  if (!parsed) return '—'
  return parsed.toFixed(2)
}

function SavedCard({ item, score, buyerMatchCount }: { item: Row; score: Row | null; buyerMatchCount: number }) {
  const listing = item.market_listings as Row
  const dealScore = Math.round(Number(score?.deal_score || 0))
  const rentConfidence = Math.round(Number(score?.rent_confidence_score || listing.rent_confidence_score || 0))
  const dealStatus = String(listing.deal_status || 'needs_review')
  const why = String(listing.why_this_deal || score?.why_this_ranks || '').trim()
  return (
    <article className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035] p-4">
      <Link href={`/market/${listing.id}`} className="block">
        {listing.primary_image_url ? <div className="h-48 rounded-2xl bg-cover bg-center" style={{ backgroundImage: `url(${listing.primary_image_url})` }} /> : <div className="flex h-48 items-center justify-center rounded-2xl border border-white/10 bg-slate-900 text-slate-500">No image yet</div>}
      </Link>
      <div className="mt-4 flex items-start justify-between gap-3">
        <div>
          <Link href={`/market/${listing.id}`} className="text-lg font-bold hover:underline">{listing.title || listing.address || 'Saved listing'}</Link>
          <p className="mt-1 text-sm text-slate-400">{[listing.city, listing.state, listing.zip_code].filter(Boolean).join(', ') || 'Location pending'}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-xs font-semibold text-sky-100">{String(item.status).replaceAll('_', ' ')}</span>
          <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold text-slate-200">{dealStatusLabel(dealStatus as any)}</span>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
        <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3"><div className="text-xs text-slate-500">Score</div><div className="font-bold">{dealScore || '—'}</div></div>
        <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3"><div className="text-xs text-slate-500">Rent conf.</div><div className="font-bold">{rentConfidence ? `${rentConfidence}%` : '—'}</div></div>
        <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3"><div className="text-xs text-slate-500">Buyer matches</div><div className="font-bold">{buyerMatchCount || '—'}</div></div>
        <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3"><div className="text-xs text-slate-500">Price</div><div className="font-bold">{money(listing.list_price || listing.asking_price, true)}</div></div>
        <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3"><div className="text-xs text-slate-500">Cashflow</div><div className="font-bold text-emerald-300">{money(score?.estimated_monthly_cashflow, true)}</div></div>
        <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3"><div className="text-xs text-slate-500">DSCR / Cap</div><div className="font-bold">{ratio(score?.estimated_dscr)} / {percent(score?.estimated_cap_rate)}</div></div>
      </div>
      {why ? <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-50"><div className="text-xs font-bold uppercase tracking-wide text-emerald-200">Why this deal?</div><p className="mt-1 text-emerald-50/90">{why}</p></div> : null}
      {listing.review_reason ? <p className="mt-3 text-xs text-slate-400">Review: {listing.review_reason}</p> : null}
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <form action={updateMarketListingReviewStatusAction}><input type="hidden" name="listing_id" value={listing.id} /><input type="hidden" name="deal_status" value="ready" /><input type="hidden" name="review_reason" value="Moved from watchlist to opportunity after manual review." /><input type="hidden" name="return_to" value="/saved-deals" /><button className="w-full rounded-xl bg-emerald-300 px-3 py-2 text-sm font-semibold text-slate-950">Move to opportunity</button></form>
        <form action={convertListingToDealAction}><input type="hidden" name="listing_id" value={listing.id} /><button className="w-full rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-950">Analyze</button></form>
        <form action={saveOpportunityAction}><input type="hidden" name="listing_id" value={listing.id} /><input type="hidden" name="status" value="contacted" /><button className="w-full rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold text-slate-100">Contacted</button></form>
        <form action={saveOpportunityAction}><input type="hidden" name="listing_id" value={listing.id} /><input type="hidden" name="status" value="passed" /><button className="w-full rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold text-slate-100">Pass</button></form>
      </div>
    </article>
  )
}

export default async function SavedDealsPage({ searchParams }: { searchParams?: Promise<Search> }) {
  const params = await searchParams
  const activeStatus = one(params?.status, 'all')
  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()

  let watchQuery = supabase
    .from('market_watchlist')
    .select('*, market_listings(*)')
    .eq('user_id', workspace.user.id)
    .order('updated_at', { ascending: false })
    .limit(120)
  if (workspace.organization?.id) watchQuery = watchQuery.eq('organization_id', workspace.organization.id)
  if (activeStatus !== 'all') watchQuery = watchQuery.eq('status', activeStatus)

  const { data: watchRows } = await watchQuery
  const listingIds = (watchRows || []).map((row: Row) => row.listing_id).filter(Boolean)
  const { data: scores } = listingIds.length
    ? await supabase.from('market_listing_scores').select('*').in('listing_id', listingIds).order('calculated_at', { ascending: false }).limit(300)
    : { data: [] as Row[] }
  const scoreMap = latestScoreMap(scores as Row[])
  const { data: buyerMatches } = listingIds.length
    ? await supabase.from('buyer_deal_matches').select('listing_id, match_score').in('listing_id', listingIds).gte('match_score', 55)
    : { data: [] as Row[] }
  const buyerMatchCount = new Map<string, number>()
  for (const match of (buyerMatches || []) as Row[]) {
    const key = String(match.listing_id || '')
    if (!key) continue
    buyerMatchCount.set(key, (buyerMatchCount.get(key) || 0) + 1)
  }

  return (
    <AppShell organizationName={workspace.organization?.name} userEmail={workspace.user.email} accountType={workspace.access.accountType} features={workspace.access.features} subscriptionStatus={workspace.access.status} planName={workspace.access.plan?.name} trialEndsAt={workspace.access.trialEndsAt} isPlatformAdmin={workspace.access.isPlatformAdmin}>
      <div className="space-y-6">
        <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-sky-500/15 via-slate-950 to-black p-6 sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-sm font-bold uppercase tracking-wide text-sky-300">Your personal pipeline</div>
              <h1 className="mt-2 text-4xl font-black tracking-tight">Saved Deals</h1>
              <p className="mt-3 max-w-3xl text-slate-300">Your saved Market listings, watchlist, contacted deals and converted opportunities. This is personal to your account.</p>
            </div>
            <Link href="/opportunities" className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950">Find Opportunities</Link>
          </div>
        </section>
        <nav className="flex gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03] p-2">
          {statuses.map(([key, label]) => <Link key={key} href={`/saved-deals?status=${key}`} className={`shrink-0 rounded-xl px-4 py-2 text-sm font-semibold ${activeStatus === key ? 'bg-white text-slate-950' : 'text-slate-300 hover:bg-white/10'}`}>{label}</Link>)}
        </nav>
        {(watchRows || []).length ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{(watchRows || []).map((item: Row) => item.market_listings ? <SavedCard key={item.id} item={item} score={scoreMap.get(String(item.listing_id)) || null} buyerMatchCount={buyerMatchCount.get(String(item.listing_id)) || 0} /> : null)}</div> : <div className="rounded-3xl border border-dashed border-white/15 bg-white/[0.03] p-10 text-center"><h2 className="text-xl font-bold">No saved deals yet</h2><p className="mt-2 text-slate-400">Save listings from Market or Opportunities to build your personal deal pipeline.</p><Link href="/opportunities" className="mt-5 inline-flex rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950">Open Opportunities</Link></div>}
      </div>
    </AppShell>
  )
}
