import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { canUseFeature } from '@/lib/billing/features'
import {
  convertListingToDealAction,
  createMarketSourceAction,
  importMarketCsvAction,
  importMarketUrlAction,
  rescoreMarketListingAction,
  runMarketSourceAction,
  saveOpportunityAction,
} from '@/app/market/actions'
import { getMarketSourceAdapters } from '@/lib/market/sourceAdapters'
import { dealStatusLabel } from '@/lib/market/review'
import { OPPORTUNITY_RENT_CONFIDENCE_THRESHOLD, OPPORTUNITY_SCORE_THRESHOLD, STRONG_OPPORTUNITY_SCORE_THRESHOLD } from '@/lib/market/opportunityRules'
import { SubmitButton } from '@/components/forms/SubmitButton'

type Search = Record<string, string | string[] | undefined>
type Row = Record<string, any>

const tabs = [
  ['all', 'All Listings'],
  ['public', 'Public'],
  ['community', 'Community'],
  ['needs_review', 'Needs Review'],
]

const propertyTypes = ['Single Family', 'Duplex', 'Triplex', 'Fourplex', 'Multifamily', 'Mixed Use', 'Retail', 'Office', 'Industrial', 'Land', 'Condo', 'Townhouse']

function one(value: string | string[] | undefined, fallback = '') {
  if (Array.isArray(value)) return value[0] || fallback
  return value || fallback
}

function money(value: number | string | null | undefined, compact = false) {
  const parsed = Number(value || 0)
  if (!parsed) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, notation: compact ? 'compact' : 'standard' }).format(parsed)
}

function dateText(value: string | null | undefined) {
  if (!value) return 'Not scheduled'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}


function initials(title: string) {
  return title.split(/\s+/).filter(Boolean).slice(0, 2).map((item) => item[0]?.toUpperCase()).join('') || 'DF'
}

function latestScoreMap(scores: Row[] | null | undefined) {
  const map = new Map<string, Row>()
  for (const score of scores || []) {
    const id = String(score.listing_id)
    const existing = map.get(id)
    const currentScore = Number(score.deal_score || 0)
    const existingScore = Number(existing?.deal_score || 0)
    const currentTime = new Date(String(score.calculated_at || score.created_at || 0)).getTime()
    const existingTime = new Date(String(existing?.calculated_at || existing?.created_at || 0)).getTime()
    if (!existing || currentScore > existingScore || (currentScore === existingScore && currentTime > existingTime)) map.set(id, score)
  }
  return map
}

function metricFromListingOrScore(listing: Row, score: Row | null | undefined, listingKey: string, scoreKey: string) {
  const listingValue = listing[listingKey]
  return listingValue !== null && listingValue !== undefined && listingValue !== '' ? listingValue : score?.[scoreKey]
}

function watchMap(rows: Row[] | null | undefined) {
  const map = new Map<string, Row>()
  for (const row of rows || []) map.set(String(row.listing_id), row)
  return map
}

function scoreTone(score: number) {
  if (score >= 80) return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
  if (score >= 65) return 'border-amber-400/30 bg-amber-400/10 text-amber-100'
  return 'border-white/10 bg-white/5 text-slate-200'
}

function riskTone(risk: string | null | undefined) {
  const value = String(risk || '').toLowerCase()
  if (value === 'low') return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
  if (value === 'high') return 'border-red-400/30 bg-red-400/10 text-red-100'
  return 'border-amber-400/30 bg-amber-400/10 text-amber-100'
}

function Field({ label, name, placeholder, type = 'text', defaultValue }: { label: string; name: string; placeholder?: string; type?: string; defaultValue?: string }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-300">{label}</span>
      <input name={name} type={type} defaultValue={defaultValue} placeholder={placeholder} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none placeholder:text-slate-600 focus:border-white/30" />
    </label>
  )
}

function ImageBlock({ listing }: { listing: Row }) {
  const image = String(listing.primary_image_url || '')
  if (image) return <div className="h-48 rounded-2xl bg-cover bg-center" style={{ backgroundImage: `url(${image})` }} />
  return (
    <div className="flex h-48 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950">
      <div className="text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-lg font-bold text-slate-200">{initials(String(listing.title || 'Deal'))}</div>
        <div className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-500">No image yet</div>
      </div>
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${tone || 'text-slate-100'}`}>{value}</div>
    </div>
  )
}

function ListingCard({ listing, score, watch }: { listing: Row; score: Row | null; watch: Row | null }) {
  const dealScore = Math.round(Number(metricFromListingOrScore(listing, score, 'latest_deal_score', 'deal_score') || 0))
  const rentConfidence = Math.round(Number(metricFromListingOrScore(listing, score, 'latest_rent_confidence_score', 'rent_confidence_score') || 0))
  const location = [listing.city, listing.state, listing.zip_code].filter(Boolean).join(', ') || listing.address || 'Location pending'
  const reasons = Array.isArray(score?.reasons) ? score.reasons : []
  const risks = Array.isArray(score?.risks) ? score.risks : []
  return (
    <article className="group overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035] p-4 transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.055]">
      <Link href={`/market/${listing.id}`} className="block"><ImageBlock listing={listing} /></Link>
      <div className="mt-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/market/${listing.id}`} className="line-clamp-2 text-lg font-bold text-white hover:underline">{listing.title}</Link>
          <p className="mt-1 text-sm text-slate-400">{location}</p>
        </div>
        <div className={`shrink-0 rounded-2xl border px-3 py-2 text-center ${scoreTone(dealScore)}`}>
          <div className="text-[10px] font-semibold uppercase tracking-wide">Score</div>
          <div className="text-xl font-bold">{dealScore || '—'}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-300">{listing.property_type || 'Type pending'}</span>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-300">{listing.units || 1} unit(s)</span>
        <span className={`rounded-full border px-3 py-1 ${riskTone(score?.risk_level)}`}>Risk: {score?.risk_level || 'medium'}</span>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-300">Rent confidence: {rentConfidence || '—'}</span>
        <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-sky-100">{dealStatusLabel(listing.deal_status)}</span>
        {watch?.status ? <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-sky-100">{String(watch.status).replaceAll('_', ' ')}</span> : null}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Metric label="Price" value={money(listing.list_price || listing.asking_price, true)} />
        <Metric label="Cashflow" value={money(metricFromListingOrScore(listing, score, 'latest_estimated_monthly_cashflow', 'estimated_monthly_cashflow'))} tone={Number(metricFromListingOrScore(listing, score, 'latest_estimated_monthly_cashflow', 'estimated_monthly_cashflow') || 0) > 0 ? 'text-emerald-300' : undefined} />
        <Metric label="Rent confidence" value={rentConfidence ? `${rentConfidence}/100` : '—'} tone={rentConfidence >= 65 ? 'text-emerald-300' : undefined} />
        <Metric label="DSCR" value={metricFromListingOrScore(listing, score, 'latest_estimated_dscr', 'estimated_dscr') ? Number(metricFromListingOrScore(listing, score, 'latest_estimated_dscr', 'estimated_dscr')).toFixed(2) : '—'} />
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Why this ranks</div>
        {reasons.length ? (
          <ul className="mt-2 space-y-1 text-xs leading-5 text-slate-400">{reasons.slice(0, 2).map((reason: string, index: number) => <li key={index}>• {reason}</li>)}</ul>
        ) : <p className="mt-2 text-xs leading-5 text-slate-500">Add rent, price and ZIP data to improve ranking.</p>}
        {risks.length ? <p className="mt-2 text-xs text-amber-200">Risk: {String(risks[0])}</p> : null}
        {listing.why_this_deal ? <p className="mt-2 text-xs leading-5 text-slate-400">{listing.why_this_deal}</p> : null}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <form action={saveOpportunityAction}>
          <input type="hidden" name="listing_id" value={listing.id} />
          <input type="hidden" name="status" value="saved" />
          <button className="w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-200">Save</button>
        </form>
        <form action={convertListingToDealAction}>
          <input type="hidden" name="listing_id" value={listing.id} />
          <button className="w-full rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-slate-100 hover:bg-white/10">Analyze</button>
        </form>
        <form action={rescoreMarketListingAction}>
          <input type="hidden" name="listing_id" value={listing.id} />
          <button className="w-full rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-slate-300 hover:bg-white/10">Rescore</button>
        </form>
        <form action={saveOpportunityAction}>
          <input type="hidden" name="listing_id" value={listing.id} />
          <input type="hidden" name="status" value="ignored" />
          <button className="w-full rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-slate-300 hover:bg-white/10">Ignore</button>
        </form>
      </div>
    </article>
  )
}

export default async function MarketPage({ searchParams }: { searchParams?: Promise<Search> }) {
  const params = await searchParams
  const activeTab = one(params?.tab, 'all')
  if (activeTab === 'sources') redirect('/imports')
  const propertyType = one(params?.property_type)
  const city = one(params?.city)
  const state = one(params?.state)
  const zip = one(params?.zip)
  const minScore = Number(one(params?.min_score, activeTab === 'opportunities' ? String(OPPORTUNITY_SCORE_THRESHOLD) : '0'))
  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()
  const canImportSources = canUseFeature(workspace.access.features, 'market_source_imports') || Boolean(workspace.access.isPlatformAdmin)
  const canRunSources = canUseFeature(workspace.access.features, 'scheduled_market_imports') || Boolean(workspace.access.isPlatformAdmin)

  let listingsQuery = supabase.from('market_listings').select('*').order('created_at', { ascending: false }).limit(120)
  if (propertyType) listingsQuery = listingsQuery.eq('property_type', propertyType)
  if (city) listingsQuery = listingsQuery.ilike('city', `%${city}%`)
  if (state) listingsQuery = listingsQuery.ilike('state', state)
  if (zip) listingsQuery = listingsQuery.eq('zip_code', zip)
  if (activeTab === 'public') listingsQuery = listingsQuery.eq('visibility', 'public')
  if (activeTab === 'community') listingsQuery = listingsQuery.eq('visibility', 'community')
  if (activeTab === 'needs_review') listingsQuery = listingsQuery.eq('status', 'needs_review')

  const [listingsResult, scoresResult, watchResult, sourcesResult, jobsResult, queueResult] = await Promise.all([
    listingsQuery,
    supabase.from('market_listing_scores').select('*').order('deal_score', { ascending: false }).order('calculated_at', { ascending: false }).limit(500),
    workspace.organization?.id ? supabase.from('market_watchlist').select('*').eq('organization_id', workspace.organization.id).eq('user_id', workspace.user.id) : Promise.resolve({ data: [] as Row[], error: null }),
    workspace.organization?.id ? supabase.from('market_sources').select('*').eq('organization_id', workspace.organization.id).order('created_at', { ascending: false }).limit(30) : Promise.resolve({ data: [] as Row[], error: null }),
    workspace.organization?.id ? supabase.from('market_import_jobs').select('*').eq('organization_id', workspace.organization.id).order('created_at', { ascending: false }).limit(12) : Promise.resolve({ data: [] as Row[], error: null }),
    workspace.organization?.id ? supabase.from('market_source_queue_items').select('id,status,source_id').eq('organization_id', workspace.organization.id).in('status', ['queued', 'running', 'failed']) : Promise.resolve({ data: [] as Row[], error: null }),
  ])

  const listings = (listingsResult.data || []) as Row[]
  const scoresByListing = latestScoreMap(scoresResult.data as Row[] | null)
  const watchByListing = watchMap(watchResult.data as Row[] | null)
  const queueRows = (queueResult.data || []) as Row[]

  let visibleListings = [...listings]
  if (activeTab === 'opportunities') visibleListings = visibleListings.filter((listing) => {
    const score = scoresByListing.get(String(listing.id))
    return Number(metricFromListingOrScore(listing, score, 'latest_deal_score', 'deal_score') || 0) >= Math.max(OPPORTUNITY_SCORE_THRESHOLD, minScore) && Number(metricFromListingOrScore(listing, score, 'latest_rent_confidence_score', 'rent_confidence_score') || 0) >= OPPORTUNITY_RENT_CONFIDENCE_THRESHOLD
  })
  if (activeTab === 'saved') visibleListings = visibleListings.filter((listing) => ['saved', 'watching', 'contacted', 'converted_to_deal'].includes(String(watchByListing.get(String(listing.id))?.status || '')))
  visibleListings = visibleListings.filter((listing) => listing.status !== 'archived' && !['ignored', 'passed'].includes(String(watchByListing.get(String(listing.id))?.status || '')))
  visibleListings.sort((a, b) => Number(metricFromListingOrScore(b, scoresByListing.get(String(b.id)), 'latest_deal_score', 'deal_score') || 0) - Number(metricFromListingOrScore(a, scoresByListing.get(String(a.id)), 'latest_deal_score', 'deal_score') || 0))

  const totalListings = listings.length
  const opportunityCount = listings.filter((listing) => {
    const score = scoresByListing.get(String(listing.id))
    return Number(metricFromListingOrScore(listing, score, 'latest_deal_score', 'deal_score') || 0) >= OPPORTUNITY_SCORE_THRESHOLD && Number(metricFromListingOrScore(listing, score, 'latest_rent_confidence_score', 'rent_confidence_score') || 0) >= OPPORTUNITY_RENT_CONFIDENCE_THRESHOLD
  }).length
  const savedCount = listings.filter((listing) => ['saved', 'watching', 'contacted', 'converted_to_deal'].includes(String(watchByListing.get(String(listing.id))?.status || ''))).length
  const runningImports = queueRows.filter((row) => row.status === 'running').length
  const queuedImports = queueRows.filter((row) => row.status === 'queued').length

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
        <section className="overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900 via-slate-950 to-black p-6 sm:p-8">
          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
            <div>
              <div className="text-sm font-medium uppercase tracking-wide text-emerald-300">Deal acquisition engine</div>
              <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-5xl">Market & Opportunities</h1>
              <p className="mt-4 max-w-3xl text-slate-300">One clean place for imported listings, public/community deals and the highest-ranked opportunities. Deals stay in My Deals; Market is where the system finds and ranks new inventory.</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/opportunities" className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-200">View Opportunities</Link>
                <Link href="/imports" className="rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-slate-100 hover:bg-white/10">URL Import Queue</Link>
                <Link href="/imports" className="rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-slate-100 hover:bg-white/10">Import Listings</Link>
                <Link href="/deals/new" className="rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-slate-100 hover:bg-white/10">Add My Deal</Link>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
              <Metric label="Market" value={String(totalListings)} />
              <Metric label="Qualified Opportunities" value={String(opportunityCount)} tone="text-emerald-300" />
              <Metric label="Saved" value={String(savedCount)} />
              <Metric label="Queue" value={`${queuedImports} queued / ${runningImports} running`} />
            </div>
          </div>
          {params?.saved ? <div className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">Saved successfully.</div> : null}
          {params?.error ? <div className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">{String(params.error)}</div> : null}
          {listingsResult.error ? <div className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">{listingsResult.error.message}</div> : null}
        </section>

        <nav className="flex gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03] p-2">
          {tabs.map(([key, label]) => (
            <Link key={key} href={`/market?tab=${key}`} className={`shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition ${activeTab === key ? 'bg-white text-slate-950' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}>{label}</Link>
          ))}
        </nav>

        {activeTab !== 'sources' ? (
          <section className="grid gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5 lg:grid-cols-[1fr_auto]">
            <form className="grid gap-4 md:grid-cols-6" action="/market">
              <input type="hidden" name="tab" value={activeTab} />
              <label className="block md:col-span-2">
                <span className="text-sm font-medium text-slate-300">Property type</span>
                <select name="property_type" defaultValue={propertyType} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none focus:border-white/30">
                  <option value="">Any type</option>
                  {propertyTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </label>
              <Field label="City" name="city" placeholder="Tucson" defaultValue={city} />
              <Field label="State" name="state" placeholder="AZ" defaultValue={state} />
              <Field label="ZIP" name="zip" placeholder="85741" defaultValue={zip} />
              <Field label="Min score" name="min_score" type="number" defaultValue={String(minScore || '')} />
              <button className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-200 md:col-span-6">Filter Market</button>
            </form>
            <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-100 lg:w-72">
              <div className="font-semibold">Opportunity rule</div>
              <p className="mt-2 text-emerald-100/80">Listings need score 70+ and rent confidence 50+ before they are promoted into Opportunities. Strong Opportunities need 85+ score and 65+ rent confidence.</p>
            </div>
          </section>
        ) : null}

        {activeTab === 'sources' ? (
          <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
            <div className="space-y-6">
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-bold">Quick listing URL import</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-400">Paste one authorized listing URL. For search URLs like Zillow map searches, use the controlled URL Import Analyzer.</p>
                  </div>
                  {!canImportSources ? <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-100">Premium</span> : null}
                </div>
                <form action={importMarketUrlAction} className="mt-5 space-y-4">
                  <Field label="Listing URL" name="input_url" placeholder="https://www.zillow.com/homedetails/..." />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-sm font-medium text-slate-300">Source</span>
                      <select name="source_type" defaultValue="manual_url" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none focus:border-white/30">
                        {getMarketSourceAdapters().filter((adapter) => !['manual'].includes(adapter.type)).map((adapter) => <option key={adapter.type} value={adapter.type}>{adapter.label}</option>)}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-slate-300">Visibility</span>
                      <select name="visibility" defaultValue="private" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none focus:border-white/30">
                        <option value="private">Private</option>
                        <option value="team">Team Market</option>
                        <option value="community">Community</option>
                        <option value="public">Public</option>
                      </select>
                    </label>
                  </div>
                  <button className="w-full rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-200">Import and rank now</button>
                </form>
                <Link href="/imports" className="mt-3 inline-flex w-full justify-center rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-slate-100 hover:bg-white/10">Analyze search URL instead</Link>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
                <h2 className="text-xl font-bold">Create auto source</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">Add URLs once. The scheduled worker keeps checking them, updating listings and pushing qualified 70+ deals into Opportunities.</p>
                <form action={createMarketSourceAction} className="mt-5 grid gap-4">
                  <Field label="Source name" name="source_name" placeholder="Tucson Zillow Watchlist" />
                  <label className="block">
                    <span className="text-sm font-medium text-slate-300">Source type</span>
                    <select name="source_type" defaultValue="zillow" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none focus:border-white/30">
                      {getMarketSourceAdapters().filter((adapter) => ['zillow', 'crexi', 'loopnet', 'redfin', 'realtor', 'apartments', 'csv', 'partner_api', 'manual_url', 'other'].includes(adapter.type)).map((adapter) => <option key={adapter.type} value={adapter.type}>{adapter.label}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-slate-300">Authorized URLs / feed URLs</span>
                    <textarea name="source_urls" rows={5} placeholder="Paste one URL per line" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none placeholder:text-slate-600 focus:border-white/30" />
                  </label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Max URLs per run" name="max_urls_per_run" type="number" placeholder="5" />
                    <Field label="Opportunity threshold" name="opportunity_score_threshold" type="number" placeholder="70" />
                    <label className="block">
                      <span className="text-sm font-medium text-slate-300">Schedule</span>
                      <select name="schedule_frequency" defaultValue="hourly" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none focus:border-white/30">
                        <option value="hourly">Hourly</option>
                        <option value="twice_daily">Twice daily</option>
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-slate-300">Default visibility</span>
                      <select name="visibility" defaultValue="private" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none focus:border-white/30">
                        <option value="private">Private</option>
                        <option value="team">Team Market</option>
                        <option value="community">Community</option>
                        <option value="public">Public</option>
                      </select>
                    </label>
                  </div>
                  <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-sm text-slate-300">
                    <input type="checkbox" name="auto_import_enabled" defaultChecked className="h-4 w-4" />
                    Run automatically through scheduled worker
                  </label>
                  <SubmitButton pendingText="Creating source..." className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-200">Create source</SubmitButton>
                </form>
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
                <h2 className="text-xl font-bold">Active sources</h2>
                <div className="mt-5 space-y-3">
                  {(sourcesResult.data || []).map((source: Row) => {
                    const sourceQueue = queueRows.filter((row) => row.source_id === source.id)
                    return (
                      <div key={source.id} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="font-semibold text-slate-100">{source.source_name}</div>
                            <div className="mt-1 text-xs uppercase tracking-wide text-slate-500">{source.source_type} · {source.schedule_frequency} · threshold {Number(source.opportunity_score_threshold || OPPORTUNITY_SCORE_THRESHOLD)}</div>
                          </div>
                          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${source.auto_import_enabled ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100' : 'border-white/10 bg-white/5 text-slate-300'}`}>{source.auto_import_enabled ? 'Auto' : 'Manual'}</span>
                        </div>
                        <div className="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-3">
                          <div>Next: {dateText(source.next_run_at)}</div>
                          <div>Queued: {sourceQueue.filter((row) => row.status === 'queued').length}</div>
                          <div>Last: {dateText(source.last_run_at)}</div>
                        </div>
                        {source.last_error ? <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-100">{source.last_error}</div> : null}
                        <form action={runMarketSourceAction} className="mt-3">
                          <input type="hidden" name="source_id" value={source.id} />
                          <SubmitButton disabled={!canRunSources} pendingText="Running source..." className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-slate-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50">Run now</SubmitButton>
                        </form>
                      </div>
                    )
                  })}
                  {!(sourcesResult.data || []).length ? <div className="rounded-2xl border border-dashed border-white/15 p-5 text-sm text-slate-500">No sources yet. Add one source to start scheduled imports.</div> : null}
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
                <h2 className="text-xl font-bold">Recent import jobs</h2>
                <div className="mt-5 space-y-3">
                  {(jobsResult.data || []).map((job: Row) => (
                    <div key={job.id} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-slate-100">{job.job_type.replaceAll('_', ' ')}</div>
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${job.status === 'completed' ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100' : job.status === 'failed' ? 'border-red-400/30 bg-red-400/10 text-red-100' : 'border-amber-400/30 bg-amber-400/10 text-amber-100'}`}>{job.status}</span>
                      </div>
                      <div className="mt-2 text-xs text-slate-500">{dateText(job.created_at)} · created {job.items_created || 0} · updated {job.items_updated || 0} · failed {job.items_failed || 0}</div>
                      {job.error_message ? <div className="mt-2 text-xs text-red-200">{job.error_message}</div> : null}
                    </div>
                  ))}
                  {!(jobsResult.data || []).length ? <div className="rounded-2xl border border-dashed border-white/15 p-5 text-sm text-slate-500">No import jobs yet.</div> : null}
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
                <h2 className="text-xl font-bold">CSV / bulk paste</h2>
                <p className="mt-2 text-sm text-slate-400">Use this for broker sheets, partner data and batch backfills.</p>
                <form action={importMarketCsvAction} className="mt-5 space-y-4">
                  <textarea name="csv_text" rows={7} placeholder="title,address,city,state,zip,list_price,market_rent,hud_rent,primary_image_url,source_url" className="w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-white/30" />
                  <SubmitButton pendingText="Importing CSV..." className="rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-slate-100 hover:bg-white/10">Import CSV</SubmitButton>
                </form>
              </div>
            </div>
          </section>
        ) : (
          <section>
            {visibleListings.length ? (
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {visibleListings.map((listing) => <ListingCard key={listing.id} listing={listing} score={scoresByListing.get(String(listing.id)) || null} watch={watchByListing.get(String(listing.id)) || null} />)}
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-white/15 bg-white/[0.03] p-10 text-center">
                <h2 className="text-xl font-bold">No listings here yet</h2>
                <p className="mt-2 text-slate-400">Import a URL, create an auto source, or publish a deal to Market.</p>
                <Link href="/imports" className="mt-5 inline-flex rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-200">Import listing</Link>
              </div>
            )}
          </section>
        )}
      </div>
    </AppShell>
  )
}
