import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { canUseFeature } from '@/lib/billing/features'
import { convertListingToDealAction, createMarketListingAction, createMarketSourceAction, importMarketCsvAction, importMarketUrlAction, rescoreMarketListingAction, saveOpportunityAction } from '@/app/market/actions'

type Search = Record<string, string | string[] | undefined>

type Listing = Record<string, any>
type Score = Record<string, any>
type Watch = Record<string, any>

const tabs = [
  ['all', 'All Listings'],
  ['opportunities', 'Opportunities'],
  ['public', 'Public Deals'],
  ['community', 'Community Deals'],
  ['saved', 'Saved'],
  ['ignored', 'Ignored'],
  ['sources', 'Sources'],
]

const propertyTypes = [
  'Single Family',
  'Duplex',
  'Triplex',
  'Fourplex',
  'Multifamily',
  'Mixed Use',
  'Retail',
  'Office',
  'Industrial',
  'Land',
  'Condo',
  'Townhouse',
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
  if (!Number.isFinite(parsed)) return '—'
  return `${(parsed * 100).toFixed(1)}%`
}

function numberText(value: number | string | null | undefined) {
  const parsed = Number(value || 0)
  if (!parsed) return '—'
  return parsed.toLocaleString()
}

function initials(title: string) {
  return title.split(/\s+/).filter(Boolean).slice(0, 2).map((item) => item[0]?.toUpperCase()).join('') || 'DF'
}

function ListingImage({ listing }: { listing: Listing }) {
  const imageUrl = String(listing.primary_image_url || '')
  if (imageUrl) {
    return <div className="h-52 rounded-2xl bg-cover bg-center" style={{ backgroundImage: `url(${imageUrl})` }} />
  }
  return (
    <div className="flex h-52 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950">
      <div className="text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-xl font-bold text-slate-200">{initials(String(listing.title || 'Deal'))}</div>
        <div className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-500">Image pending</div>
      </div>
    </div>
  )
}

function badgeClass(value: string | null | undefined) {
  const v = String(value || '').toLowerCase()
  if (v === 'low' || v.includes('section')) return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
  if (v === 'high') return 'border-red-400/30 bg-red-400/10 text-red-100'
  if (v === 'medium') return 'border-amber-400/30 bg-amber-400/10 text-amber-100'
  return 'border-white/10 bg-white/5 text-slate-200'
}

function scoreFor(listing: Listing, scoresByListingId: Map<string, Score>) {
  return scoresByListingId.get(String(listing.id)) || null
}

function watchFor(listing: Listing, watchByListingId: Map<string, Watch>) {
  return watchByListingId.get(String(listing.id)) || null
}

function stat(label: string, value: string, tone?: string) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${tone || 'text-slate-100'}`}>{value}</div>
    </div>
  )
}

function ListingCard({ listing, score, watch }: { listing: Listing; score: Score | null; watch: Watch | null }) {
  const location = [listing.city, listing.state, listing.zip_code].filter(Boolean).join(', ') || listing.address || 'Location pending'
  const dealScore = Number(score?.deal_score || 0)
  const risk = String(score?.risk_level || 'medium')
  const strategy = score?.strategy_fit || 'Needs Review'
  return (
    <article className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035] p-4 transition hover:border-white/20 hover:bg-white/[0.055]">
      <ListingImage listing={listing} />
      <div className="mt-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="line-clamp-2 text-lg font-bold text-white">{listing.title}</h3>
          <p className="mt-1 text-sm text-slate-400">{location}</p>
        </div>
        <div className="shrink-0 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-center">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-200">Score</div>
          <div className="text-xl font-bold text-emerald-100">{dealScore || '—'}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-300">{listing.property_type || 'Property type pending'}</span>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-300">{listing.units || 1} unit(s)</span>
        <span className={`rounded-full border px-3 py-1 ${badgeClass(risk)}`}>Risk: {risk}</span>
        {watch?.status ? <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-sky-100">{String(watch.status).replaceAll('_', ' ')}</span> : null}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        {stat('Price', money(listing.list_price || listing.asking_price, true))}
        {stat('Cashflow', money(score?.estimated_monthly_cashflow), Number(score?.estimated_monthly_cashflow || 0) > 0 ? 'text-emerald-300' : 'text-slate-100')}
        {stat('HUD gap', score?.hud_rent_gap ? `${money(score.hud_rent_gap)}/mo` : '—', Number(score?.hud_rent_gap || 0) > 0 ? 'text-emerald-300' : 'text-slate-100')}
        {stat('DSCR', score?.estimated_dscr ? Number(score.estimated_dscr).toFixed(2) : '—')}
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Best fit</div>
        <div className="mt-1 font-semibold text-slate-100">{strategy}</div>
        {Array.isArray(score?.reasons) && score.reasons.length ? (
          <ul className="mt-3 space-y-1 text-xs leading-5 text-slate-400">
            {score.reasons.slice(0, 2).map((reason: string, index: number) => <li key={index}>• {reason}</li>)}
          </ul>
        ) : <p className="mt-2 text-xs leading-5 text-slate-500">Add rent, price and ZIP data to improve the score.</p>}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <form action={saveOpportunityAction}>
          <input type="hidden" name="listing_id" value={listing.id} />
          <input type="hidden" name="status" value="saved" />
          <button className="w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-200">Save</button>
        </form>
        <form action={convertListingToDealAction}>
          <input type="hidden" name="listing_id" value={listing.id} />
          <button className="w-full rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-slate-100 hover:bg-white/10">Analyze as Deal</button>
        </form>
        <form action={saveOpportunityAction}>
          <input type="hidden" name="listing_id" value={listing.id} />
          <input type="hidden" name="status" value="ignored" />
          <button className="w-full rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-slate-300 hover:bg-white/10">Ignore</button>
        </form>
        <form action={rescoreMarketListingAction}>
          <input type="hidden" name="listing_id" value={listing.id} />
          <button className="w-full rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-slate-300 hover:bg-white/10">Rescore</button>
        </form>
      </div>
      {listing.source_url ? <a href={listing.source_url} target="_blank" rel="noreferrer" className="mt-3 block text-center text-xs font-medium text-slate-400 underline hover:text-slate-200">View original source</a> : null}
    </article>
  )
}

function Field({ label, name, placeholder, type = 'text' }: { label: string; name: string; placeholder?: string; type?: string }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-300">{label}</span>
      <input name={name} type={type} step={type === 'number' ? '0.01' : undefined} placeholder={placeholder} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none placeholder:text-slate-600 focus:border-white/30" />
    </label>
  )
}

export default async function MarketPage({ searchParams }: { searchParams?: Promise<Search> }) {
  const params = await searchParams
  const activeTab = one(params?.tab, 'all')
  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()
  const canImportSources = canUseFeature(workspace.access.features, 'market_source_imports') || Boolean(workspace.access.isPlatformAdmin)
  const canPostPublic = canUseFeature(workspace.access.features, 'public_community_deals') || Boolean(workspace.access.isPlatformAdmin)

  let query = supabase
    .from('market_listings')
    .select('*')
    .order(activeTab === 'opportunities' ? 'created_at' : 'created_at', { ascending: false })
    .limit(80)

  const propertyType = one(params?.property_type)
  const state = one(params?.state)
  const city = one(params?.city)
  const zip = one(params?.zip)
  const minPrice = Number(one(params?.min_price))
  const maxPrice = Number(one(params?.max_price))

  if (activeTab === 'public') query = query.eq('visibility', 'public')
  if (activeTab === 'community') query = query.eq('visibility', 'community')
  if (activeTab === 'all' || activeTab === 'opportunities' || activeTab === 'sources') {
    // RLS decides whether private/team/org listings are visible. Keep all visible data available in All Listings.
  }
  if (propertyType) query = query.eq('property_type', propertyType)
  if (state) query = query.ilike('state', state)
  if (city) query = query.ilike('city', `%${city}%`)
  if (zip) query = query.eq('zip_code', zip)
  if (Number.isFinite(minPrice) && minPrice > 0) query = query.gte('list_price', minPrice)
  if (Number.isFinite(maxPrice) && maxPrice > 0) query = query.lte('list_price', maxPrice)

  const { data: listings, error: listingsError } = await query
  const listingIds = (listings || []).map((item: any) => item.id)

  const { data: scores } = listingIds.length
    ? await supabase
        .from('market_listing_scores')
        .select('*')
        .in('listing_id', listingIds)
        .order('calculated_at', { ascending: false })
    : { data: [] }

  const { data: watchlist } = listingIds.length && workspace.organization?.id
    ? await supabase
        .from('market_watchlist')
        .select('*')
        .eq('organization_id', workspace.organization.id)
        .eq('user_id', workspace.user.id)
        .in('listing_id', listingIds)
    : { data: [] }

  const { data: importJobs } = workspace.organization?.id
    ? await supabase
        .from('market_import_jobs')
        .select('*')
        .eq('organization_id', workspace.organization.id)
        .order('created_at', { ascending: false })
        .limit(12)
    : { data: [] }

  const { data: marketSources } = workspace.organization?.id
    ? await supabase
        .from('market_sources')
        .select('*')
        .eq('organization_id', workspace.organization.id)
        .order('created_at', { ascending: false })
        .limit(20)
    : { data: [] }

  const latestScoreByListingId = new Map<string, Score>()
  for (const score of scores || []) {
    const key = String((score as any).listing_id)
    if (!latestScoreByListingId.has(key)) latestScoreByListingId.set(key, score as any)
  }
  const watchByListingId = new Map<string, Watch>()
  for (const item of watchlist || []) watchByListingId.set(String((item as any).listing_id), item as any)

  let visibleListings = [...((listings || []) as Listing[])]
  if (activeTab === 'opportunities') {
    visibleListings = visibleListings
      .filter((item) => !['ignored', 'passed'].includes(String(watchByListingId.get(String(item.id))?.status || '')))
      .sort((a, b) => Number(scoreFor(b, latestScoreByListingId)?.deal_score || 0) - Number(scoreFor(a, latestScoreByListingId)?.deal_score || 0))
      .slice(0, 48)
  }
  if (activeTab === 'saved') visibleListings = visibleListings.filter((item) => ['saved', 'watching', 'contacted', 'converted_to_deal'].includes(String(watchByListingId.get(String(item.id))?.status || '')))
  if (activeTab === 'ignored') visibleListings = visibleListings.filter((item) => ['ignored', 'passed'].includes(String(watchByListingId.get(String(item.id))?.status || '')))

  const totalVisible = visibleListings.length
  const avgScore = totalVisible ? Math.round(visibleListings.reduce((sum, item) => sum + Number(scoreFor(item, latestScoreByListingId)?.deal_score || 0), 0) / totalVisible) : 0
  const topHudGap = visibleListings.reduce((max, item) => Math.max(max, Number(scoreFor(item, latestScoreByListingId)?.hud_rent_gap || 0)), 0)

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
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Market Intelligence</div>
              <h1 className="mt-2 text-3xl font-bold">Market</h1>
              <p className="mt-3 max-w-4xl text-slate-300">
                Browse listings, public/community deals and imported opportunities. DealFlowIQ scores every listing so the best opportunities rise to the top.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4"><div className="text-2xl font-bold">{totalVisible}</div><div className="text-xs uppercase tracking-wide text-slate-500">Visible</div></div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4"><div className="text-2xl font-bold">{avgScore || '—'}</div><div className="text-xs uppercase tracking-wide text-slate-500">Avg score</div></div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4"><div className="text-2xl font-bold">{topHudGap ? money(topHudGap, true) : '—'}</div><div className="text-xs uppercase tracking-wide text-slate-500">Top HUD gap</div></div>
            </div>
          </div>
          {params?.saved ? <div className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">Saved successfully.</div> : null}
          {params?.error ? <div className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">{String(params.error)}</div> : null}
          {listingsError ? <div className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">{listingsError.message}. Run migration 012 before using Market.</div> : null}
        </section>

        <nav className="flex gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03] p-2">
          {tabs.map(([key, label]) => (
            <Link key={key} href={`/market?tab=${key}`} className={`shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition ${activeTab === key ? 'bg-white text-slate-950' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}>{label}</Link>
          ))}
        </nav>

        {activeTab !== 'sources' ? (
          <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
            <form className="grid gap-4 md:grid-cols-6" action="/market">
              <input type="hidden" name="tab" value={activeTab} />
              <label className="block md:col-span-2">
                <span className="text-sm font-medium text-slate-300">Property type</span>
                <select name="property_type" defaultValue={propertyType} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none focus:border-white/30">
                  <option value="">Any type</option>
                  {propertyTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </label>
              <Field label="City" name="city" placeholder="Tucson" />
              <Field label="State" name="state" placeholder="AZ" />
              <Field label="ZIP" name="zip" placeholder="85741" />
              <div className="grid grid-cols-2 gap-3 md:col-span-1">
                <Field label="Min $" name="min_price" type="number" />
                <Field label="Max $" name="max_price" type="number" />
              </div>
              <button className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-200 md:col-span-6">Apply filters</button>
            </form>
          </section>
        ) : null}

        {activeTab === 'sources' ? (
          <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold">Add Market listing</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    Import authorized URLs, paste CSV feeds, or add a manual opportunity. Every source becomes a normalized Market listing, gets scored, and can be saved or converted to a deal.
                  </p>
                </div>
                {!canImportSources ? <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-100">Source imports premium</span> : null}
              </div>
              <form action={createMarketListingAction} className="mt-6 grid gap-5 md:grid-cols-2">
                <Field label="Title" name="title" placeholder="Tucson duplex with HUD upside" />
                <label className="block">
                  <span className="text-sm font-medium text-slate-300">Source</span>
                  <select name="source_type" defaultValue="manual" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none focus:border-white/30">
                    <option value="manual">Manual</option>
                    <option value="zillow">Zillow</option>
                    <option value="crexi">Crexi</option>
                    <option value="loopnet">LoopNet</option>
                    <option value="redfin">Redfin</option>
                    <option value="realtor">Realtor.com</option>
                    <option value="apartments">Apartments.com</option>
                    <option value="csv">CSV</option>
                    <option value="partner_api">Partner API</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <Field label="Source URL" name="source_url" placeholder="https://..." />
                <Field label="Primary image URL" name="primary_image_url" placeholder="https://...jpg" />
                <Field label="Address" name="address" placeholder="3949 W Mars St" />
                <Field label="City" name="city" placeholder="Tucson" />
                <Field label="State" name="state" placeholder="AZ" />
                <Field label="ZIP" name="zip_code" placeholder="85741" />
                <label className="block">
                  <span className="text-sm font-medium text-slate-300">Property type</span>
                  <select name="property_type" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none focus:border-white/30">
                    <option value="">Select type</option>
                    {propertyTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                </label>
                <Field label="Units" name="units" type="number" placeholder="2" />
                <Field label="List price" name="list_price" type="number" placeholder="350000" />
                <Field label="ARV" name="arv" type="number" placeholder="450000" />
                <Field label="Current rent" name="current_rent" type="number" />
                <Field label="Market rent" name="market_rent" type="number" />
                <Field label="HUD rent" name="hud_rent" type="number" />
                <Field label="Taxes / year" name="taxes_annual" type="number" />
                <Field label="Insurance / year" name="insurance_annual" type="number" />
                <label className="block md:col-span-2">
                  <span className="text-sm font-medium text-slate-300">Visibility</span>
                  <select name="visibility" defaultValue="private" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none focus:border-white/30">
                    <option value="private">Private Market</option>
                    <option value="team">Team Market</option>
                    <option value="community" disabled={!canPostPublic}>Community Deals</option>
                    <option value="public" disabled={!canPostPublic}>Public Deals</option>
                  </select>
                </label>
                <label className="block md:col-span-2">
                  <span className="text-sm font-medium text-slate-300">Description</span>
                  <textarea name="description" rows={4} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none focus:border-white/30" />
                </label>
                <button className="rounded-xl bg-white px-5 py-3 font-semibold text-slate-950 hover:bg-slate-200 md:col-span-2">Add to Market</button>
              </form>
            </div>
            <div className="space-y-6">
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
                <h2 className="text-xl font-bold">Source connectors</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">Create a source profile so imports can be tracked by source, access mode and rate limit.</p>
                <form action={createMarketSourceAction} className="mt-5 grid gap-3">
                  <Field label="Source name" name="source_name" placeholder="Zillow Tucson buy box" />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-sm font-medium text-slate-300">Source type</span>
                      <select name="source_type" defaultValue="zillow" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none focus:border-white/30">
                        <option value="zillow">Zillow</option>
                        <option value="crexi">Crexi</option>
                        <option value="loopnet">LoopNet</option>
                        <option value="redfin">Redfin</option>
                        <option value="realtor">Realtor.com</option>
                        <option value="apartments">Apartments.com</option>
                        <option value="csv">CSV</option>
                        <option value="partner_api">Partner/API</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-slate-300">Access mode</span>
                      <select name="access_mode" defaultValue="authorized_scrape" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none focus:border-white/30">
                        <option value="authorized_scrape">Authorized scrape</option>
                        <option value="api">API</option>
                        <option value="csv">CSV</option>
                        <option value="manual_url">Manual URL</option>
                        <option value="feed">Feed</option>
                      </select>
                    </label>
                  </div>
                  <Field label="Source URL / search URL" name="source_url" placeholder="https://..." />
                  <Field label="Daily limit" name="rate_limit_per_day" type="number" placeholder="25" />
                  <button disabled={!canImportSources} className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40">Save source</button>
                </form>
                <div className="mt-5 space-y-2">
                  {(marketSources || []).length ? (marketSources || []).map((source: any) => (
                    <div key={source.id} className="rounded-2xl border border-white/10 bg-slate-950/40 p-3 text-sm">
                      <div className="font-semibold text-slate-100">{source.source_name}</div>
                      <div className="mt-1 text-xs text-slate-500">{source.source_type} · {source.access_mode} · {source.status}</div>
                    </div>
                  )) : <div className="rounded-2xl border border-dashed border-white/15 p-4 text-sm text-slate-500">No saved sources yet.</div>}
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
                <h2 className="text-xl font-bold">Import from URL</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">Fetch one authorized listing URL and normalize it into Market. If a source blocks server access, the job fails cleanly and you can paste it manually/CSV instead.</p>
                <form action={importMarketUrlAction} className="mt-5 grid gap-3">
                  <Field label="Listing URL" name="input_url" placeholder="https://www.zillow.com/..." />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-sm font-medium text-slate-300">Source</span>
                      <select name="source_type" defaultValue="manual" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none focus:border-white/30">
                        <option value="manual">Auto-detect</option>
                        <option value="zillow">Zillow</option>
                        <option value="crexi">Crexi</option>
                        <option value="loopnet">LoopNet</option>
                        <option value="redfin">Redfin</option>
                        <option value="realtor">Realtor.com</option>
                        <option value="apartments">Apartments.com</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-slate-300">Visibility</span>
                      <select name="visibility" defaultValue="private" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none focus:border-white/30">
                        <option value="private">Private Market</option>
                        <option value="team">Team Market</option>
                        <option value="community" disabled={!canPostPublic}>Community Deals</option>
                        <option value="public" disabled={!canPostPublic}>Public Deals</option>
                      </select>
                    </label>
                  </div>
                  <button disabled={!canImportSources} className="rounded-xl bg-emerald-300 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-40">Import URL & score</button>
                </form>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
                <h2 className="text-xl font-bold">CSV / bulk paste</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">Paste rows from a broker feed or export. Headers can include title,address,city,state,zip,list_price,market_rent,hud_rent,primary_image_url,source_url.</p>
                <form action={importMarketCsvAction} className="mt-5 grid gap-3">
                  <label className="block">
                    <span className="text-sm font-medium text-slate-300">CSV rows</span>
                    <textarea name="csv_text" rows={6} placeholder="title,address,city,state,zip,list_price,market_rent,primary_image_url" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-white/30" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-slate-300">Visibility</span>
                    <select name="visibility" defaultValue="private" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none focus:border-white/30">
                      <option value="private">Private Market</option>
                      <option value="team">Team Market</option>
                      <option value="community" disabled={!canPostPublic}>Community Deals</option>
                      <option value="public" disabled={!canPostPublic}>Public Deals</option>
                    </select>
                  </label>
                  <button disabled={!canImportSources} className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40">Import CSV & score</button>
                </form>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
                <h2 className="text-xl font-bold">Import jobs</h2>
                <div className="mt-5 space-y-3">
                  {(importJobs || []).length ? (importJobs || []).map((job: any) => (
                    <div key={job.id} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="truncate font-semibold text-slate-100">{job.input_url || job.job_type}</div>
                        <span className={`rounded-full border px-3 py-1 text-xs capitalize ${String(job.status) === 'failed' ? 'border-red-400/30 bg-red-400/10 text-red-100' : String(job.status) === 'completed' ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100' : 'border-white/10 text-slate-300'}`}>{String(job.status).replaceAll('_', ' ')}</span>
                      </div>
                      <div className="mt-2 text-xs text-slate-500">Found {job.items_found || 0} · Created {job.items_created || 0} · Updated {job.items_updated || 0} · Failed {job.items_failed || 0}</div>
                      {job.error_message ? <div className="mt-2 rounded-xl border border-red-500/20 bg-red-500/10 p-2 text-xs text-red-100">{job.error_message}</div> : null}
                    </div>
                  )) : <div className="rounded-2xl border border-dashed border-white/15 p-6 text-sm text-slate-500">No import jobs yet.</div>}
                </div>
              </div>
            </div>
          </section>
        ) : visibleListings.length ? (
          <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {visibleListings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} score={scoreFor(listing, latestScoreByListingId)} watch={watchFor(listing, watchByListingId)} />
            ))}
          </section>
        ) : (
          <section className="rounded-3xl border border-dashed border-white/15 bg-white/[0.02] p-10 text-center">
            <h2 className="text-2xl font-bold">No Market listings yet</h2>
            <p className="mx-auto mt-3 max-w-2xl text-slate-400">Add a listing in Sources or publish one of your deals to Team, Community or Public Market.</p>
            <Link href="/market?tab=sources" className="mt-6 inline-flex rounded-xl bg-white px-5 py-3 font-semibold text-slate-950 hover:bg-slate-200">Add first listing</Link>
          </section>
        )}
      </div>
    </AppShell>
  )
}
