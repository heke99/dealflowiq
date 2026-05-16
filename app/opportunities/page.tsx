import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { convertListingToDealAction, rescoreMarketListingAction, saveOpportunityAction } from '@/app/market/actions'
import { classifyOpportunity, OPPORTUNITY_RENT_CONFIDENCE_THRESHOLD, OPPORTUNITY_SCORE_THRESHOLD, STRONG_OPPORTUNITY_RENT_CONFIDENCE_THRESHOLD, STRONG_OPPORTUNITY_SCORE_THRESHOLD } from '@/lib/market/opportunityRules'

type Row = Record<string, any>

function money(value: number | string | null | undefined, compact = false) {
  const parsed = Number(value || 0)
  if (!parsed) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, notation: compact ? 'compact' : 'standard' }).format(parsed)
}

function imageStyle(url?: string | null) {
  return url ? { backgroundImage: `url(${url})` } : undefined
}

function confidence(score: Row) {
  const data = Number(score.data_confidence_score || 0)
  if (data >= 80) return 'High confidence'
  if (data >= 55) return 'Medium confidence'
  return 'Needs review'
}

function OpportunityCard({ score }: { score: Row }) {
  const listing = score.market_listings as Row
  const reasons = Array.isArray(score.reasons) ? score.reasons : []
  const risks = Array.isArray(score.risks) ? score.risks : []
  const dealScore = Math.round(Number(listing.latest_deal_score ?? score.deal_score ?? 0))
  const rentConfidence = Math.round(Number(listing.latest_rent_confidence_score ?? score.rent_confidence_score ?? 0))
  const rank = classifyOpportunity(dealScore, rentConfidence, Array.isArray(score.missing_fields) && score.missing_fields.length > 0)
  return (
    <article className="overflow-hidden rounded-3xl border border-emerald-400/20 bg-gradient-to-b from-emerald-400/[0.08] to-white/[0.03] p-4 shadow-2xl shadow-black/20">
      <Link href={`/market/${listing.id}`} className="block">
        {listing.primary_image_url ? (
          <div className="h-56 rounded-2xl bg-cover bg-center" style={imageStyle(listing.primary_image_url)} />
        ) : (
          <div className="flex h-56 items-center justify-center rounded-2xl border border-white/10 bg-slate-900 text-slate-500">No image yet</div>
        )}
      </Link>
      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <Link href={`/market/${listing.id}`} className="text-xl font-bold text-white hover:underline">{listing.title || listing.address || 'Market listing'}</Link>
          <p className="mt-1 text-sm text-slate-400">{[listing.city, listing.state, listing.zip_code].filter(Boolean).join(', ') || 'Location pending'}</p>
        </div>
        <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-center text-emerald-100">
          <div className="text-[10px] font-bold uppercase tracking-wide">{rank.label}</div>
          <div className="text-3xl font-black">{dealScore}</div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-3"><div className="text-xs text-slate-500">Price</div><div className="font-bold">{money(listing.list_price || listing.asking_price, true)}</div></div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-3"><div className="text-xs text-slate-500">Cashflow</div><div className="font-bold text-emerald-300">{money(listing.latest_estimated_monthly_cashflow ?? score.estimated_monthly_cashflow)}</div></div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-3"><div className="text-xs text-slate-500">DSCR</div><div className="font-bold">{(listing.latest_estimated_dscr ?? score.estimated_dscr) ? Number(listing.latest_estimated_dscr ?? score.estimated_dscr).toFixed(2) : '—'}</div></div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-3"><div className="text-xs text-slate-500">Rent confidence</div><div className="font-bold text-emerald-300">{rentConfidence}</div></div>
      </div>
      <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
          <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-emerald-100">{confidence(score)}</span>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-300">{score.strategy_fit || 'Strategy pending'}</span>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-300">Risk: {score.risk_level || 'medium'}</span>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-300">Rent confidence: {rentConfidence}/100</span>
        </div>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Why this ranks</div>
            <ul className="mt-2 space-y-1 text-sm leading-6 text-slate-300">{(reasons.length ? reasons : ['Strong score based on available underwriting inputs.']).slice(0, 3).map((reason: string, index: number) => <li key={index}>• {reason}</li>)}</ul>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Risks / missing</div>
            <ul className="mt-2 space-y-1 text-sm leading-6 text-slate-400">{(risks.length ? risks : ['Verify taxes, insurance, rent and rehab before making an offer.']).slice(0, 3).map((risk: string, index: number) => <li key={index}>• {risk}</li>)}</ul>
          </div>
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <form action={saveOpportunityAction}><input type="hidden" name="listing_id" value={listing.id} /><input type="hidden" name="status" value="saved" /><button className="w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-950">Save</button></form>
        <form action={convertListingToDealAction}><input type="hidden" name="listing_id" value={listing.id} /><button className="w-full rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-slate-100">Analyze</button></form>
        <form action={rescoreMarketListingAction}><input type="hidden" name="listing_id" value={listing.id} /><button className="w-full rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-slate-100">Rescore</button></form>
        <Link href={`/market/${listing.id}`} className="rounded-xl border border-white/10 px-4 py-3 text-center text-sm font-semibold text-slate-100">View</Link>
      </div>
    </article>
  )
}

export default async function OpportunitiesPage() {
  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()

  let query = supabase
    .from('market_listings')
    .select('*')
    .gte('latest_deal_score', OPPORTUNITY_SCORE_THRESHOLD)
    .gte('latest_rent_confidence_score', OPPORTUNITY_RENT_CONFIDENCE_THRESHOLD)
    .neq('status', 'archived')
    .order('latest_deal_score', { ascending: false })
    .limit(80)

  if (workspace.organization?.id) {
    query = query.or(`organization_id.eq.${workspace.organization.id},visibility.eq.public`)
  } else {
    query = query.eq('visibility', 'public')
  }

  const { data: listingsData } = await query
  const listingIds = ((listingsData || []) as Row[]).map((listing) => String(listing.id))
  const { data: scoreRows } = listingIds.length
    ? await supabase
        .from('market_listing_scores')
        .select('*')
        .in('listing_id', listingIds)
        .order('deal_score', { ascending: false })
        .order('calculated_at', { ascending: false })
        .limit(300)
    : { data: [] as Row[] }

  const scoreByListing = new Map<string, Row>()
  for (const score of (scoreRows || []) as Row[]) {
    const listingId = String(score.listing_id)
    const existing = scoreByListing.get(listingId)
    if (!existing || Number(score.deal_score || 0) > Number(existing.deal_score || 0)) scoreByListing.set(listingId, score)
  }

  const scores = ((listingsData || []) as Row[]).map((listing) => {
    const score = scoreByListing.get(String(listing.id)) || {}
    return {
      ...score,
      id: score.id || `listing-${listing.id}`,
      listing_id: listing.id,
      deal_score: listing.latest_deal_score ?? score.deal_score ?? 0,
      rent_confidence_score: listing.latest_rent_confidence_score ?? score.rent_confidence_score ?? 0,
      data_confidence_score: listing.latest_data_confidence_score ?? score.data_confidence_score ?? 0,
      source_confidence_score: listing.latest_source_confidence_score ?? score.source_confidence_score ?? 0,
      estimated_monthly_cashflow: listing.latest_estimated_monthly_cashflow ?? score.estimated_monthly_cashflow ?? 0,
      estimated_dscr: listing.latest_estimated_dscr ?? score.estimated_dscr ?? null,
      estimated_cap_rate: listing.latest_estimated_cap_rate ?? score.estimated_cap_rate ?? null,
      market_listings: listing,
    }
  })

  return (
    <AppShell organizationName={workspace.organization?.name} userEmail={workspace.user.email} accountType={workspace.access.accountType} features={workspace.access.features} subscriptionStatus={workspace.access.status} planName={workspace.access.plan?.name} trialEndsAt={workspace.access.trialEndsAt} isPlatformAdmin={workspace.access.isPlatformAdmin}>
      <div className="space-y-6">
        <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-emerald-500/15 via-slate-950 to-black p-6 sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-sm font-bold uppercase tracking-wide text-emerald-300">70+ score · 50+ rent confidence</div>
              <h1 className="mt-2 text-4xl font-black tracking-tight">Opportunities</h1>
              <p className="mt-3 max-w-3xl text-slate-300">Listings with DealFlowIQ score 70+ and rent confidence 50+ appear here. 85+ score with 65+ rent confidence is marked as Strong Opportunity.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/buy-boxes" className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950">Create Buy Box</Link>
              <Link href="/market?tab=sources" className="rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-slate-100">Run Imports</Link>
            </div>
          </div>
        </section>
        {scores.length ? <div className="grid gap-6 xl:grid-cols-2">{scores.map((score) => <OpportunityCard key={score.id} score={score} />)}</div> : <div className="rounded-3xl border border-dashed border-white/15 bg-white/[0.03] p-10 text-center"><h2 className="text-xl font-bold">No qualified opportunities yet</h2><p className="mt-2 text-slate-400">Create a Buy Box, run a source, or import authorized URLs. Listings need 70+ score and 50+ rent confidence to appear here automatically. Strong Opportunities need 85+ score and 65+ rent confidence.</p><Link href="/buy-boxes" className="mt-5 inline-flex rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950">Create Buy Box</Link></div>}
      </div>
    </AppShell>
  )
}
