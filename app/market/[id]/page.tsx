import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { addMarketListingNoteAction, convertListingToDealAction, rescoreMarketListingAction, saveOpportunityAction, updateMarketListingReviewStatusAction } from '@/app/market/actions'
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
  const [{ data: listing }, { data: scores }, { data: watch }, { data: buyerMatches }, { data: notes }, { data: activity }] = await Promise.all([
    supabase.from('market_listings').select('*').eq('id', id).maybeSingle(),
    supabase.from('market_listing_scores').select('*').eq('listing_id', id).order('calculated_at', { ascending: false }).limit(1),
    workspace.organization?.id ? supabase.from('market_watchlist').select('*').eq('listing_id', id).eq('user_id', workspace.user.id).maybeSingle() : Promise.resolve({ data: null }),
    workspace.organization?.id && buyersEnabled ? supabase.from('buyer_deal_matches').select('*, buyers(name, company_name, email, phone, status)').eq('listing_id', id).eq('organization_id', workspace.organization.id).order('match_score', { ascending: false }).limit(8) : Promise.resolve({ data: [] as Row[] }),
    workspace.organization?.id ? supabase.from('market_listing_notes').select('*').eq('listing_id', id).eq('organization_id', workspace.organization.id).order('created_at', { ascending: false }).limit(8) : Promise.resolve({ data: [] as Row[] }),
    workspace.organization?.id ? supabase.from('market_listing_activity_events').select('*').eq('listing_id', id).eq('organization_id', workspace.organization.id).order('created_at', { ascending: false }).limit(12) : Promise.resolve({ data: [] as Row[] }),
  ])

  if (!listing) notFound()
  const row = listing as Row
  const score = (scores || [])[0] as Row | undefined
  const dealScore = Math.round(Number(score?.deal_score || 0))
  const rentConfidence = Math.round(Number(score?.rent_confidence_score || 0))
  const isQualifiedOpportunity = dealScore >= 80 && rentConfidence >= 65
  const matches = (buyerMatches || []) as Row[]
  const noteRows = (notes || []) as Row[]
  const activityRows = (activity || []) as Row[]
  const images = [row.primary_image_url, ...asStringArray(row.image_urls)].filter(Boolean).filter((value, index, arr) => arr.indexOf(value) === index).slice(0, 8)
  const reasons = Array.isArray(score?.reasons) ? score.reasons : []
  const risks = Array.isArray(score?.risks) ? score.risks : []
  const missing = Array.isArray(score?.missing_fields) ? score.missing_fields : []
  const location = [row.address, row.city, row.state, row.zip_code].filter(Boolean).join(', ')

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
                {row.source_url ? <a href={row.source_url} target="_blank" rel="noreferrer" className="rounded-xl border border-white/10 px-5 py-3 text-center text-sm font-semibold text-slate-100 hover:bg-white/10">Open source</a> : null}
              </div>
              {watch?.status ? <p className="mt-4 text-xs text-slate-500">Your status: {String((watch as Row).status).replaceAll('_', ' ')}</p> : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <Metric label="Price" value={money(row.list_price || row.asking_price)} />
              <Metric label="Units" value={numberText(row.units || 1)} />
              <Metric label="Market rent" value={money(row.market_rent || row.estimated_rent)} />
              <Metric label="HUD rent" value={money(row.hud_rent)} />
              <Metric label="Monthly cashflow" value={money(score?.estimated_monthly_cashflow)} tone={Number(score?.estimated_monthly_cashflow || 0) > 0 ? 'text-emerald-300' : undefined} />
              <Metric label="DSCR" value={score?.estimated_dscr ? Number(score.estimated_dscr).toFixed(2) : '—'} />
              <Metric label="Cap rate" value={percent(score?.estimated_cap_rate)} />
              <Metric label="Break-even rent" value={money(score?.break_even_rent)} />
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
