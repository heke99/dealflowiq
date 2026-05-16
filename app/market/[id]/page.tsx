import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { addListingManualOverrideAction, addMarketListingNoteAction, convertListingToDealAction, ignoreMarketListingAction, rescoreMarketListingAction, runListingFullIntelligenceAction, runListingHudLookupAction, runListingMarketRentAction, saveOpportunityAction, updateMarketListingAnalysisInputsAction, updateMarketListingReviewStatusAction, updateMarketListingStageAction } from '@/app/market/actions'
import { canUseFeature } from '@/lib/billing/features'
import { dealStatusLabel } from '@/lib/market/review'

type Row = Record<string, any>

function money(value: number | string | null | undefined, compact = false) {
  const parsed = Number(value || 0)
  if (!parsed) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, notation: compact ? 'compact' : 'standard' }).format(parsed)
}

function numberText(value: number | string | null | undefined) {
  const parsed = Number(value || 0)
  if (!parsed) return '—'
  return parsed.toLocaleString()
}

function percent(value: number | string | null | undefined) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return '—'
  return `${(parsed * 100).toFixed(1)}%`
}

function dateText(value: string | null | undefined) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter((item) => typeof item === 'string' && item.startsWith('http')).slice(0, 12)
}

function Metric({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-2 text-xl font-bold ${tone || 'text-white'}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </div>
  )
}

function daysUntil(value: string | null | undefined) {
  if (!value) return null
  const days = Math.ceil((new Date(value).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  return Number.isFinite(days) ? days : null
}

function scoreTone(score: number) {
  if (score >= 80) return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
  if (score >= 65) return 'border-amber-400/30 bg-amber-400/10 text-amber-100'
  return 'border-white/10 bg-white/5 text-slate-200'
}

export default async function MarketListingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()

  const buyersEnabled = canUseFeature(workspace.access.features, 'buyer_matching') || Boolean(workspace.access.isPlatformAdmin)
  const [{ data: listing }, { data: scores }, { data: watch }, { data: buyerMatches }, { data: notes }, { data: activity }, { data: rentEstimates }, { data: hudSnapshots }, { data: manualOverrides }] = await Promise.all([
    supabase.from('market_listings').select('*').eq('id', id).maybeSingle(),
    supabase.from('market_listing_scores').select('*').eq('listing_id', id).order('deal_score', { ascending: false }).order('calculated_at', { ascending: false }).limit(1),
    workspace.organization?.id ? supabase.from('market_watchlist').select('*').eq('listing_id', id).eq('user_id', workspace.user.id).maybeSingle() : Promise.resolve({ data: null }),
    workspace.organization?.id && buyersEnabled ? supabase.from('buyer_deal_matches').select('*, buyers(name, company_name, email, phone, status)').eq('listing_id', id).eq('organization_id', workspace.organization.id).order('match_score', { ascending: false }).limit(8) : Promise.resolve({ data: [] as Row[] }),
    workspace.organization?.id ? supabase.from('market_listing_notes').select('*').eq('listing_id', id).eq('organization_id', workspace.organization.id).order('created_at', { ascending: false }).limit(8) : Promise.resolve({ data: [] as Row[] }),
    workspace.organization?.id ? supabase.from('market_listing_activity_events').select('*').eq('listing_id', id).eq('organization_id', workspace.organization.id).order('created_at', { ascending: false }).limit(12) : Promise.resolve({ data: [] as Row[] }),
    workspace.organization?.id ? supabase.from('listing_rent_estimates').select('*').eq('listing_id', id).eq('organization_id', workspace.organization.id).order('created_at', { ascending: false }).limit(5) : Promise.resolve({ data: [] as Row[] }),
    workspace.organization?.id ? supabase.from('listing_hud_rent_snapshots').select('*').eq('listing_id', id).eq('organization_id', workspace.organization.id).order('created_at', { ascending: false }).limit(5) : Promise.resolve({ data: [] as Row[] }),
    workspace.organization?.id ? supabase.from('listing_manual_overrides').select('*').eq('listing_id', id).eq('organization_id', workspace.organization.id).order('created_at', { ascending: false }).limit(8) : Promise.resolve({ data: [] as Row[] }),
  ])

  if (!listing) notFound()
  const row = listing as Row
  const score = (scores || [])[0] as Row | undefined
  const dealScore = Math.round(Number(row.latest_deal_score ?? score?.deal_score ?? 0))
  const rentConfidence = Math.round(Number(row.latest_rent_confidence_score ?? score?.rent_confidence_score ?? 0))
  const isQualifiedOpportunity = dealScore >= 80 && rentConfidence >= 65
  const matches = (buyerMatches || []) as Row[]
  const noteRows = (notes || []) as Row[]
  const activityRows = (activity || []) as Row[]
  const rentRows = (rentEstimates || []) as Row[]
  const hudRows = (hudSnapshots || []) as Row[]
  const overrideRows = (manualOverrides || []) as Row[]
  const images = [row.primary_image_url, ...asStringArray(row.image_urls)].filter(Boolean).filter((value, index, arr) => arr.indexOf(value) === index).slice(0, 8)
  const reasons = Array.isArray(score?.reasons) ? score.reasons : []
  const risks = Array.isArray(score?.risks) ? score.risks : []
  const missing = Array.isArray(score?.missing_fields) ? score.missing_fields : []
  const location = [row.address, row.city, row.state, row.zip_code].filter(Boolean).join(', ')
  const expiryDays = daysUntil(row.provider_data_expires_at)
  const dataChecklist = Array.isArray(row.data_quality_checklist) ? row.data_quality_checklist : []
  const confidenceBreakdown = row.confidence_breakdown && typeof row.confidence_breakdown === 'object' ? row.confidence_breakdown : {}
  const confidencePositives = Array.isArray(confidenceBreakdown.positives) ? confidenceBreakdown.positives : []
  const confidenceNegatives = Array.isArray(confidenceBreakdown.negatives) ? confidenceBreakdown.negatives : []

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
        <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900 via-slate-950 to-black p-6 sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <Link href="/market" className="text-sm font-medium text-slate-400 hover:text-white">← Back to Market</Link>
              <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <span>{row.source_type || 'market'}</span>
                <span>•</span>
                <span>{row.visibility || 'private'}</span>
                <span>•</span>
                <span>{dealStatusLabel(row.deal_status)}</span>
                <span>•</span>
                <span>{dateText(row.created_at)}</span>
              </div>
              <h1 className="mt-3 max-w-4xl text-3xl font-bold tracking-tight sm:text-5xl">{row.title}</h1>
              <p className="mt-3 text-slate-300">{location || 'Location pending'}</p>
            </div>
            <div className={`rounded-3xl border px-6 py-5 text-center ${scoreTone(dealScore)}`}>
              <div className="text-xs font-semibold uppercase tracking-wide">Deal Score</div>
              <div className="mt-1 text-5xl font-black">{dealScore || '—'}</div>
              <div className="mt-1 text-sm">{isQualifiedOpportunity ? 'Qualified opportunity' : dealStatusLabel(row.deal_status)}</div>
            </div>
          </div>
        </section>

        {row.provider_data_expired_at ? <div className="rounded-2xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm text-amber-50">Provider data expired. DealFlowIQ analysis is retained, but copied provider content was removed.</div> : row.provider_data_expires_at ? <div className="rounded-2xl border border-sky-400/25 bg-sky-400/10 p-4 text-sm text-sky-50">Provider data expires {expiryDays !== null ? expiryDays >= 0 ? `in ${expiryDays} day(s)` : 'now' : ''}. Source link, scores, notes and DealFlowIQ analysis stay after cleanup.</div> : null}

        <section className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-5">
            <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-4">
              {images.length ? (
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="h-80 rounded-2xl bg-cover bg-center md:col-span-2" style={{ backgroundImage: `url(${images[0]})` }} />
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-1">
                    {images.slice(1, 4).map((image) => <div key={image} className="h-24 rounded-2xl bg-cover bg-center md:h-[98px]" style={{ backgroundImage: `url(${image})` }} />)}
                    {images.length === 1 ? <div className="flex h-24 items-center justify-center rounded-2xl border border-dashed border-white/15 text-sm text-slate-500">More images pending</div> : null}
                  </div>
                </div>
              ) : (
                <div className="flex h-80 items-center justify-center rounded-2xl border border-dashed border-white/15 bg-slate-950/40 text-slate-500">No listing images yet</div>
              )}
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xl font-bold">Why this ranked {dealScore || '—'}</h2>
              <div className="mt-5 grid gap-4 md:grid-cols-3">
                <Metric label="Risk" value={String(score?.risk_level || 'medium')} />
                <Metric label="Confidence" value={String(score?.data_confidence || 'low')} />
                <Metric label="Rent confidence" value={rentConfidence ? `${rentConfidence}/100` : '—'} tone={rentConfidence >= 65 ? 'text-emerald-300' : undefined} />
                <Metric label="Deal status" value={dealStatusLabel(row.deal_status)} />
                <Metric label="Best strategy" value={String(score?.strategy_fit || 'Needs review')} />
              </div>
              {row.why_this_deal ? <div className="mt-5 rounded-2xl border border-sky-400/20 bg-sky-400/10 p-4 text-sm leading-6 text-sky-50">{row.why_this_deal}</div> : null}
              {row.review_reason ? <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-sm leading-6 text-slate-300">Review note: {row.review_reason}</div> : null}
              <div className="mt-6 grid gap-5 md:grid-cols-3">
                <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
                  <div className="text-sm font-bold text-emerald-100">Positive signals</div>
                  {reasons.length ? <ul className="mt-3 space-y-2 text-sm leading-6 text-emerald-50/80">{reasons.map((reason: string, index: number) => <li key={index}>• {reason}</li>)}</ul> : <p className="mt-3 text-sm text-emerald-50/70">Add price, rent and expense data to generate reasons.</p>}
                </div>
                <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4">
                  <div className="text-sm font-bold text-amber-100">Risks</div>
                  {risks.length ? <ul className="mt-3 space-y-2 text-sm leading-6 text-amber-50/80">{risks.map((risk: string, index: number) => <li key={index}>• {risk}</li>)}</ul> : <p className="mt-3 text-sm text-amber-50/70">No major risks from current inputs.</p>}
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                  <div className="text-sm font-bold text-slate-100">Missing data</div>
                  {missing.length ? <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-400">{missing.map((field: string, index: number) => <li key={index}>• {field}</li>)}</ul> : <p className="mt-3 text-sm text-slate-500">No critical missing fields.</p>}
                </div>
              </div>
            </div>


            <div className="rounded-3xl border border-emerald-400/20 bg-emerald-400/[0.06] p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-xl font-bold text-emerald-50">Analysis inputs</h2>
                  <p className="mt-2 text-sm leading-6 text-emerald-50/75">These fields are the source of truth for score, ranking, Market and Opportunities. Saving recalculates the score immediately.</p>
                </div>
                <span className="rounded-full border border-emerald-400/25 px-3 py-1 text-xs font-semibold uppercase text-emerald-100">Syncs score</span>
              </div>
              <form action={updateMarketListingAnalysisInputsAction} className="mt-5">
                <input type="hidden" name="listing_id" value={row.id} />
                <div className="grid gap-3 md:grid-cols-3">
                  <input name="list_price" defaultValue={row.list_price || ''} placeholder="List price" className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600" />
                  <input name="asking_price" defaultValue={row.asking_price || ''} placeholder="Asking price" className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600" />
                  <input name="arv" defaultValue={row.arv || ''} placeholder="ARV" className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600" />
                  <input name="current_rent" defaultValue={row.current_rent || ''} placeholder="Current rent" className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600" />
                  <input name="market_rent" defaultValue={row.market_rent || row.estimated_rent || ''} placeholder="Market rent" className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600" />
                  <input name="hud_rent" defaultValue={row.hud_rent || ''} placeholder="HUD/FMR rent" className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600" />
                  <input name="target_rent" defaultValue={row.target_rent || ''} placeholder="Target rent" className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600" />
                  <input name="rehab_estimate" defaultValue={row.rehab_estimate || ''} placeholder="Rehab estimate" className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600" />
                  <input name="taxes_annual" defaultValue={row.taxes_annual || ''} placeholder="Annual taxes" className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600" />
                  <input name="insurance_annual" defaultValue={row.insurance_annual || ''} placeholder="Annual insurance" className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600" />
                  <input name="hoa_monthly" defaultValue={row.hoa_monthly || ''} placeholder="Monthly HOA" className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600" />
                  <input name="utilities_monthly" defaultValue={row.utilities_monthly || ''} placeholder="Monthly utilities" className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600" />
                  <input name="capex_monthly" defaultValue={row.capex_monthly || ''} placeholder="Monthly capex" className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600" />
                  <input name="vacancy_percent" defaultValue={row.vacancy_percent || ''} placeholder="Vacancy %" className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600" />
                  <input name="management_percent" defaultValue={row.management_percent || ''} placeholder="Management %" className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600" />
                  <input name="down_payment_percent" defaultValue={row.down_payment_percent || ''} placeholder="Down payment %" className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600" />
                  <input name="interest_rate_percent" defaultValue={row.interest_rate_percent || ''} placeholder="Interest rate %" className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600" />
                  <input name="loan_term_months" defaultValue={row.loan_term_months || ''} placeholder="Loan term months" className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600" />
                </div>
                <button className="mt-4 rounded-xl bg-emerald-300 px-5 py-3 text-sm font-bold text-slate-950 hover:bg-emerald-200">Update analysis & sync score</button>
              </form>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xl font-bold">Rent intelligence</h2>
              <div className="mt-5 grid gap-4 md:grid-cols-3">
                <Metric label="Market rent" value={money(row.market_rent || row.estimated_rent || score?.market_rent)} />
                <Metric label="HUD/FMR rent" value={money(row.hud_rent)} />
                <Metric label="Rent confidence" value={rentConfidence ? `${rentConfidence}/100` : '—'} tone={rentConfidence >= 65 ? 'text-emerald-300' : 'text-amber-300'} />
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4"><div className="text-sm font-bold">Latest market rent estimates</div>{rentRows.length ? <div className="mt-3 space-y-2 text-sm text-slate-300">{rentRows.map((rent) => <div key={rent.id}>• {money(rent.estimated_rent)} ({rent.confidence_score || 0}/100) · {dateText(rent.created_at)}</div>)}</div> : <p className="mt-3 text-sm text-slate-500">No market rent run yet.</p>}</div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4"><div className="text-sm font-bold">Latest HUD/FMR snapshots</div>{hudRows.length ? <div className="mt-3 space-y-2 text-sm text-slate-300">{hudRows.map((hud) => <div key={hud.id}>• HUD {hud.hud_year || '—'} · {money(hud.selected_fmr)} · {hud.lookup_status}</div>)}</div> : <p className="mt-3 text-sm text-slate-500">No HUD/FMR lookup yet.</p>}</div>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xl font-bold">Data quality & confidence</h2>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4"><div className="text-sm font-bold">Checklist</div><div className="mt-3 space-y-2 text-sm">{dataChecklist.length ? dataChecklist.map((item: Row, index: number) => <div key={item.key || index} className={item.ok ? 'text-emerald-200' : 'text-amber-200'}>{item.ok ? '✓' : '⚠'} {item.label}</div>) : <p className="text-slate-500">Run rent intelligence to generate checklist.</p>}</div></div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4"><div className="text-sm font-bold">Confidence breakdown</div><div className="mt-3 grid gap-3 text-sm"><div>{confidencePositives.map((item: string, index: number) => <div key={index} className="text-emerald-200">+ {item}</div>)}</div><div>{confidenceNegatives.map((item: string, index: number) => <div key={index} className="text-amber-200">- {item}</div>)}</div>{!confidencePositives.length && !confidenceNegatives.length ? <p className="text-slate-500">No confidence breakdown yet.</p> : null}</div></div>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xl font-bold">Description</h2>
              <p className="mt-3 whitespace-pre-line text-sm leading-7 text-slate-300">{row.description || 'No source description imported yet. Use original source or add this listing as a deal to enrich the analysis.'}</p>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xl font-bold">Deal notes</h2>
              <form action={addMarketListingNoteAction} className="mt-4 grid gap-3">
                <input type="hidden" name="listing_id" value={row.id} />
                <select name="note_type" defaultValue="internal" className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none">
                  <option value="internal">Internal note</option>
                  <option value="seller_call">Seller / broker call</option>
                  <option value="buyer_feedback">Buyer feedback</option>
                  <option value="underwriting">Underwriting</option>
                  <option value="offer">Offer</option>
                  <option value="risk">Risk</option>
                </select>
                <textarea name="note" rows={4} placeholder="Called seller, rent numbers need review, buyer X interested..." className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600" />
                <button className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-200">Add note</button>
              </form>
              <div className="mt-5 space-y-3">
                {noteRows.map((note) => <div key={note.id} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{String(note.note_type).replaceAll('_', ' ')} · {dateText(note.created_at)}</div><p className="mt-2 text-sm leading-6 text-slate-300">{note.note}</p></div>)}
                {!noteRows.length ? <p className="text-sm text-slate-500">No notes yet.</p> : null}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xl font-bold">Activity timeline</h2>
              <div className="mt-5 space-y-3">
                {activityRows.map((event) => <div key={event.id} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4"><div className="flex items-start justify-between gap-3"><div><div className="font-semibold text-white">{event.title}</div><div className="mt-1 text-xs uppercase tracking-wide text-slate-500">{String(event.event_type).replaceAll('_', ' ')}</div></div><div className="text-xs text-slate-500">{dateText(event.created_at)}</div></div>{event.description ? <p className="mt-2 text-sm leading-6 text-slate-400">{event.description}</p> : null}</div>)}
                {!activityRows.length ? <p className="text-sm text-slate-500">Timeline will fill as this deal is imported, scored, saved, matched and reviewed.</p> : null}
              </div>
            </div>
          </div>

          <aside className="space-y-5">
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xl font-bold">Actions</h2>
              <div className="mt-5 grid gap-3">
                <form action={convertListingToDealAction}>
                  <input type="hidden" name="listing_id" value={row.id} />
                  <button className="w-full rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-200">Analyze as Deal</button>
                </form>
                <form action={saveOpportunityAction}>
                  <input type="hidden" name="listing_id" value={row.id} />
                  <input type="hidden" name="status" value="saved" />
                  <button className="w-full rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-slate-100 hover:bg-white/10">Save to Watchlist</button>
                </form>
                <form action={rescoreMarketListingAction}>
                  <input type="hidden" name="listing_id" value={row.id} />
                  <button className="w-full rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-slate-100 hover:bg-white/10">Recalculate score</button>
                </form>
                <form action={runListingFullIntelligenceAction}>
                  <input type="hidden" name="listing_id" value={row.id} />
                  <button className="w-full rounded-xl border border-emerald-400/30 px-5 py-3 text-sm font-semibold text-emerald-100 hover:bg-emerald-400/10">Run Market Rent + HUD/FMR</button>
                </form>
                <form action={runListingMarketRentAction}>
                  <input type="hidden" name="listing_id" value={row.id} />
                  <button className="w-full rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-slate-100 hover:bg-white/10">Run Market Rent</button>
                </form>
                <form action={runListingHudLookupAction}>
                  <input type="hidden" name="listing_id" value={row.id} />
                  <button className="w-full rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-slate-100 hover:bg-white/10">Run HUD/FMR Lookup</button>
                </form>
                <form action={updateMarketListingReviewStatusAction} className="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
                  <input type="hidden" name="listing_id" value={row.id} />
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Review status</label>
                  <select name="deal_status" defaultValue={row.deal_status || 'needs_review'} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none">
                    <option value="ready">Ready / Opportunity</option>
                    <option value="needs_review">Needs review</option>
                    <option value="missing_data">Missing data</option>
                    <option value="low_confidence">Low confidence</option>
                    <option value="archived">Archived</option>
                  </select>
                  <input name="review_reason" placeholder="Reason" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600" />
                  <button className="mt-2 w-full rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-white/10">Update review</button>
                </form>
                <form action={updateMarketListingStageAction} className="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
                  <input type="hidden" name="listing_id" value={row.id} />
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Deal stage</label>
                  <select name="deal_stage" defaultValue={row.deal_stage || 'imported'} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none">
                    <option value="imported">Imported</option><option value="needs_review">Needs Review</option><option value="analyzed">Analyzed</option><option value="watchlist">Watchlist</option><option value="opportunity">Opportunity</option><option value="underwriting">Underwriting</option><option value="offer_made">Offer Made</option><option value="rejected">Rejected</option><option value="archived">Archived</option>
                  </select>
                  <button className="mt-2 w-full rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-white/10">Update stage</button>
                </form>
                <form action={addListingManualOverrideAction} className="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
                  <input type="hidden" name="listing_id" value={row.id} />
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Manual override</label>
                  <select name="field_name" defaultValue="market_rent" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none"><option value="market_rent">Market rent</option><option value="hud_rent">HUD rent</option><option value="current_rent">Current rent</option><option value="estimated_rent">Estimated rent</option><option value="target_rent">Target rent</option><option value="list_price">List price</option><option value="rehab_estimate">Rehab estimate</option></select>
                  <input name="new_value" placeholder="New value" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600" />
                  <input name="reason" placeholder="Reason" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600" />
                  <label className="mt-2 flex items-center gap-2 text-xs text-slate-400"><input type="checkbox" name="apply_to_score" defaultChecked /> Apply to score</label>
                  <button className="mt-2 w-full rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-white/10">Save override</button>
                </form>
                <form action={ignoreMarketListingAction} className="rounded-2xl border border-red-400/20 bg-red-400/5 p-3">
                  <input type="hidden" name="listing_id" value={row.id} />
                  <label className="block text-xs font-semibold uppercase tracking-wide text-red-200">Ignore / do not re-import</label>
                  <select name="ignore_reason" defaultValue="not_investment_suitable" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none"><option value="bad_area">Bad area</option><option value="wrong_asset_type">Wrong asset type</option><option value="duplicate">Duplicate</option><option value="already_reviewed">Already reviewed</option><option value="unrealistic_price">Unrealistic price</option><option value="not_investment_suitable">Not investment suitable</option><option value="other">Other</option></select>
                  <input name="ignore_notes" placeholder="Optional note" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600" />
                  <button className="mt-2 w-full rounded-xl border border-red-400/30 px-3 py-2 text-sm font-semibold text-red-100 hover:bg-red-400/10">Ignore listing</button>
                </form>
                {row.source_url ? <a href={row.source_url} target="_blank" rel="noreferrer" className="rounded-xl border border-white/10 px-5 py-3 text-center text-sm font-semibold text-slate-100 hover:bg-white/10">Open source</a> : null}
              </div>
              {watch?.status ? <p className="mt-4 text-xs text-slate-500">Your status: {String((watch as Row).status).replaceAll('_', ' ')}</p> : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <Metric label="Price" value={money(row.list_price || row.asking_price)} />
              <Metric label="Units" value={numberText(row.units || 1)} />
              <Metric label="Current rent" value={money(row.current_rent)} />
              <Metric label="Market rent" value={money(row.market_rent || row.estimated_rent || score?.market_rent)} />
              <Metric label="HUD rent" value={money(row.hud_rent)} />
              <Metric label="Target rent" value={money(row.target_rent)} />
              <Metric label="Stage" value={String(row.deal_stage || 'imported').replaceAll('_', ' ')} />
              <Metric label="Monthly cashflow" value={money(row.latest_estimated_monthly_cashflow ?? score?.estimated_monthly_cashflow)} tone={Number(row.latest_estimated_monthly_cashflow ?? score?.estimated_monthly_cashflow ?? 0) > 0 ? 'text-emerald-300' : undefined} />
              <Metric label="DSCR" value={(row.latest_estimated_dscr ?? score?.estimated_dscr) ? Number(row.latest_estimated_dscr ?? score?.estimated_dscr).toFixed(2) : '—'} />
              <Metric label="Cap rate" value={percent(row.latest_estimated_cap_rate ?? score?.estimated_cap_rate)} />
              <Metric label="Break-even rent" value={money(row.latest_break_even_rent ?? score?.break_even_rent)} />
            </div>

            {buyersEnabled ? (
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-xl font-bold">Buyer matches</h2>
                  <Link href="/buyers" className="text-sm font-semibold text-slate-300 hover:text-white">Open buyers</Link>
                </div>
                <div className="mt-4 space-y-3">
                  {matches.map((match) => {
                    const buyer = match.buyers as Row | null
                    return (
                      <div key={match.id} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold text-white">{buyer?.name || 'Buyer'}</div>
                            <div className="mt-1 text-xs text-slate-500">{buyer?.company_name || buyer?.email || buyer?.phone || 'Contact pending'}</div>
                          </div>
                          <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-100">{Math.round(Number(match.match_score || 0))}</span>
                        </div>
                      </div>
                    )
                  })}
                  {!matches.length ? <p className="text-sm leading-6 text-slate-500">No buyer matches yet. Run buyer matching from Buyers after adding buyer criteria.</p> : null}
                </div>
              </div>
            ) : null}

            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xl font-bold">Broker / contact</h2>
              <dl className="mt-4 space-y-3 text-sm">
                <div className="flex justify-between gap-4"><dt className="text-slate-500">Name</dt><dd className="text-right text-slate-200">{row.broker_name || '—'}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-slate-500">Phone</dt><dd className="text-right text-slate-200">{row.broker_phone || '—'}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-slate-500">Email</dt><dd className="text-right text-slate-200">{row.broker_email || '—'}</dd></div>
              </dl>
            </div>
          </aside>
        </section>
      </div>
    </AppShell>
  )
}
