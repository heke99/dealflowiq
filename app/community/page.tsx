import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { canUseFeature } from '@/lib/billing/features'

type Row = Record<string, any>

function numberText(value: number | null | undefined) {
  return new Intl.NumberFormat('en-US').format(Number(value || 0))
}

function money(value: number | string | null | undefined, compact = false) {
  const parsed = Number(value || 0)
  if (!parsed) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, notation: compact ? 'compact' : 'standard' }).format(parsed)
}

function StageCard({ label, value, hint, href }: { label: string; value: string; hint: string; href: string }) {
  return (
    <Link href={href} className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-white/25 hover:bg-white/[0.06]">
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-3 text-3xl font-black">{value}</div>
      <div className="mt-3 text-xs leading-5 text-slate-500">{hint}</div>
    </Link>
  )
}

function DealRow({ listing }: { listing: Row }) {
  return (
    <Link href={`/market/${listing.id}`} className="block rounded-2xl border border-white/10 bg-slate-950/50 p-4 transition hover:border-white/20 hover:bg-white/[0.06]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="line-clamp-1 font-bold text-white">{listing.title || listing.address || 'Community listing'}</div>
          <div className="mt-1 text-xs text-slate-500">{[listing.city, listing.state, listing.zip_code].filter(Boolean).join(', ') || 'Location pending'}</div>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold uppercase tracking-wide">
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-slate-300">{listing.visibility || 'community'}</span>
            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-emerald-100">Score {Math.round(Number(listing.latest_deal_score || 0))}</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-slate-300">Rent {Math.round(Number(listing.latest_rent_confidence_score || 0))}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm text-slate-500">Price</div>
          <div className="font-black text-white">{money(listing.list_price || listing.asking_price, true)}</div>
        </div>
      </div>
    </Link>
  )
}

export default async function CommunityDashboardPage() {
  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()
  const orgId = workspace.organization?.id
  const hasCommunityAccess = canUseFeature(workspace.access.features, 'community_members') || canUseFeature(workspace.access.features, 'public_community_deals') || workspace.access.accountType === 'community_guru_owner' || workspace.access.isPlatformAdmin

  const [communityListingsResult, publicListingsResult, buyerMatchResult, savedResult, recentListingsResult, needsReviewResult] = orgId
    ? await Promise.all([
        supabase.from('market_listings').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('visibility', 'community'),
        supabase.from('market_listings').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('visibility', 'public'),
        supabase.from('buyer_deal_matches').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).gte('match_score', 70),
        supabase.from('market_watchlist').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
        supabase.from('market_listings').select('*').eq('organization_id', orgId).in('visibility', ['community', 'public']).order('created_at', { ascending: false }).limit(8),
        supabase.from('market_listings').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).in('deal_status', ['needs_review', 'missing_data', 'low_confidence']).in('visibility', ['community', 'public']),
      ])
    : [{ count: 0 }, { count: 0 }, { count: 0 }, { count: 0 }, { data: [] }, { count: 0 }]

  const recentListings = (recentListingsResult.data || []) as Row[]

  return (
    <AppShell organizationName={workspace.organization?.name} userEmail={workspace.user.email} accountType={workspace.access.accountType} features={workspace.access.features} subscriptionStatus={workspace.access.status} planName={workspace.access.plan?.name} trialEndsAt={workspace.access.trialEndsAt} isPlatformAdmin={workspace.access.isPlatformAdmin}>
      <div className="space-y-8">
        <section className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-purple-500/15 via-slate-950 to-emerald-500/10 p-6 sm:p-8">
          <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
            <div>
              <div className="text-sm font-black uppercase tracking-wide text-purple-300">Community workspace</div>
              <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">A better deal room for your members and team.</h1>
              <p className="mt-4 max-w-3xl text-slate-300">Publish community deals, review submitted opportunities, match buyers and keep every public-facing listing backed by real underwriting data.</p>
              {!hasCommunityAccess ? (
                <div className="mt-5 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
                  Community features are not enabled on this workspace yet. You can still review the dashboard structure and upgrade when ready.
                </div>
              ) : null}
              <div className="mt-7 flex flex-wrap gap-3">
                <Link href="/market?tab=community" className="rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950 hover:bg-slate-200">View community deals</Link>
                <Link href="/market?tab=sources" className="rounded-2xl border border-white/10 px-5 py-3 text-sm font-bold text-white hover:bg-white/10">Import listings</Link>
                <Link href="/buyers" className="rounded-2xl border border-white/10 px-5 py-3 text-sm font-bold text-white hover:bg-white/10">Buyer CRM</Link>
              </div>
            </div>
            <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-5">
              <h2 className="text-xl font-black">Community operating model</h2>
              <div className="mt-5 space-y-3 text-sm text-slate-300">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><span className="font-bold text-white">1. Source</span> listings from approved providers or internal submissions.</div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><span className="font-bold text-white">2. Review</span> rent, HUD/FMR, DSCR and confidence before publishing.</div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><span className="font-bold text-white">3. Match</span> buyers and members with the deals that fit their buy boxes.</div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StageCard label="Community deals" value={numberText(communityListingsResult.count || 0)} hint="Listings visible to community members." href="/market?tab=community" />
          <StageCard label="Public deals" value={numberText(publicListingsResult.count || 0)} hint="Published externally/publicly." href="/market?tab=public" />
          <StageCard label="Needs review" value={numberText(needsReviewResult.count || 0)} hint="Quality checks before publishing." href="/market?tab=needs_review" />
          <StageCard label="Buyer matches" value={numberText(buyerMatchResult.count || 0)} hint="Potential community/buyer fit." href="/buyers" />
          <StageCard label="Saved" value={numberText(savedResult.count || 0)} hint="Watchlisted by workspace users." href="/saved-deals" />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black">Latest community/public listings</h2>
                <p className="mt-1 text-sm text-slate-500">Listings that can be reviewed for members, buyers or public deal rooms.</p>
              </div>
              <Link href="/market?tab=community" className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-white/10">Open Market</Link>
            </div>
            <div className="mt-5 space-y-3">
              {recentListings.length ? recentListings.map((listing) => <DealRow key={listing.id} listing={listing} />) : (
                <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-slate-400">No community/public deals yet. Import listings or publish reviewed deals to community visibility.</div>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-2xl font-black">Make the community feel premium</h2>
            <div className="mt-5 space-y-3">
              {[
                ['Publish only after review', 'Use Needs Review until rent, HUD/FMR and deal score are verified.'],
                ['Keep deal context visible', 'Show why a deal is strong, what is missing and what buyers should verify.'],
                ['Use in-app alerts first', 'No email/SMS yet. Keep member and buyer notifications inside DealFlowIQ.'],
                ['Protect source data', 'Keep provider source links, expiry banners and retention cleanup visible.'],
              ].map(([title, text]) => (
                <div key={title} className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                  <div className="font-bold text-white">{title}</div>
                  <div className="mt-2 text-sm leading-6 text-slate-400">{text}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  )
}
