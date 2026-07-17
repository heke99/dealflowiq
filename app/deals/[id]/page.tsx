import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { FinancialSnapshot } from '@/components/deals/FinancialSnapshot'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { archiveDealAction, deleteDealAction, deleteDealFileAction, duplicateDealAction, quickUpdateDealAssumptionsAction } from '@/app/deals/actions'
import { publishDealToMarketAction, unpublishDealAction } from '@/app/market/actions'
import { asRows, firstRow, type Row } from '@/lib/types/rows'
import { publicErrorMessage } from '@/lib/errors/public-errors'

function money(value: unknown) {
  const numberValue = Number(value || 0)
  if (!numberValue) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(numberValue)
}

function percent(value: unknown) {
  const numberValue = Number(value || 0)
  if (!numberValue) return '—'
  return `${numberValue}%`
}


function DealHeroImage({ deal, heroImageUrl }: { deal: Row; heroImageUrl?: string | null }) {
  const imageUrl = String(heroImageUrl || deal.primary_image_url || '')
  if (imageUrl) {
    return <div className="h-64 rounded-3xl border border-white/10 bg-cover bg-center" style={{ backgroundImage: `url(${imageUrl})` }} />
  }
  return (
    <div className="flex h-64 items-center justify-center rounded-3xl border border-dashed border-white/15 bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950">
      <div className="text-center">
        <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Property image pending</div>
        <div className="mt-2 text-sm text-slate-400">Add an image URL when editing the deal so it looks right in Market.</div>
      </div>
    </div>
  )
}

function row(label: string, value: React.ReactNode) {
  return (
    <div className="flex justify-between gap-4 border-b border-white/10 py-3 last:border-b-0">
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-right font-medium text-slate-100">{value}</dd>
    </div>
  )
}

function QuickField({ label, name, defaultValue, placeholder }: { label: string; name: string; defaultValue?: unknown; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <input name={name} type="number" step="0.01" defaultValue={String(defaultValue ?? '')} placeholder={placeholder} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-white/30" />
    </label>
  )
}

type SignedDealFile = Row & { signedUrl: string | null }

async function signDealFiles(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, files: Row[]): Promise<SignedDealFile[]> {
  const signed: SignedDealFile[] = []
  for (const file of files) {
    const { data } = await supabase.storage.from(String(file.storage_bucket || 'deal-files')).createSignedUrl(String(file.storage_path), 60 * 60)
    signed.push({ ...file, signedUrl: data?.signedUrl || null })
  }
  return signed
}

function DeleteDealFileButton({ dealId, fileId }: { dealId: string; fileId: string }) {
  return (
    <form action={deleteDealFileAction}>
      <input type="hidden" name="deal_id" value={dealId} />
      <input type="hidden" name="file_id" value={fileId} />
      <input type="hidden" name="redirect_to" value={`/deals/${dealId}`} />
      <button
        className="rounded-lg border border-red-400/30 bg-red-500/10 px-2.5 py-1 text-xs font-semibold text-red-200 transition hover:bg-red-500/25"
        title="Permanently deletes this file from storage"
      >
        Delete
      </button>
    </form>
  )
}

function DealFilesSection({ dealId, files }: { dealId: string; files: SignedDealFile[] }) {
  if (!files.length) return null
  const images = files.filter((file): file is Row & { signedUrl: string } => file.file_kind === 'image' && Boolean(file.signedUrl))
  const documents = files.filter((file): file is Row & { signedUrl: string } => file.file_kind === 'pdf' && Boolean(file.signedUrl))
  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Files & photos</div>
          <h2 className="mt-2 text-xl font-bold">Uploaded deal media</h2>
        </div>
        <Link href="#" className="hidden" aria-hidden="true">.</Link>
      </div>
      {images.length ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((file) => (
            <div key={String(file.id)} className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/50">
              <a href={file.signedUrl} target="_blank" rel="noreferrer" className="group block">
                <div className="h-44 bg-cover bg-center transition group-hover:scale-[1.02]" style={{ backgroundImage: `url(${file.signedUrl})` }} />
              </a>
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="truncate text-xs text-slate-400">{String(file.file_name)}</span>
                <DeleteDealFileButton dealId={dealId} fileId={String(file.id)} />
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {documents.length ? (
        <div className="mt-5 grid gap-2">
          {documents.map((file) => (
            <div key={String(file.id)} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm">
              <a href={file.signedUrl} target="_blank" rel="noreferrer" className="flex min-w-0 flex-1 items-center justify-between gap-3 hover:opacity-80">
                <span className="truncate font-semibold text-slate-100">{String(file.file_name)}</span>
                <span className="shrink-0 text-xs text-slate-500">Open PDF</span>
              </a>
              <DeleteDealFileButton dealId={dealId} fileId={String(file.id)} />
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}

export default async function DealDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params
  const query = await searchParams
  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()
  const organizationId = workspace.organization?.id

  const { data: dealData } = organizationId
    ? await supabase
        .from('deals')
        .select('*, properties(*)')
        .eq('id', id)
        .eq('organization_id', organizationId)
        .maybeSingle()
    : { data: null }

  if (!dealData) notFound()
  const deal = dealData as Row

  const { data: dealFiles } = await supabase
    .from('deal_files')
    .select('*')
    .eq('deal_id', id)
    .eq('organization_id', organizationId)
    .order('file_kind', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  const signedDealFiles = await signDealFiles(supabase, asRows(dealFiles))
  const firstUploadedImage = signedDealFiles.find((file) => file.file_kind === 'image' && file.signedUrl)?.signedUrl || null

  const property = firstRow(deal.properties)
  const currentRent = Number(deal.current_rent || 0)
  const marketRent = Number(deal.market_rent || 0)
  const hudRent = Number(deal.section8_rent || 0)
  const rentGap = marketRent - currentRent
  const hudGap = hudRent - currentRent
  const savedVisibility = deal.visibility
  const publishVisibility = savedVisibility === 'public' || savedVisibility === 'community' || savedVisibility === 'team' ? savedVisibility : 'team'

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
        <section className="grid gap-6 rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-8 lg:grid-cols-[1fr_360px] lg:items-start">
          <div>
            <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Deal Detail</div>
            <h1 className="mt-2 text-3xl font-bold">{String(deal.title)}</h1>
            <p className="mt-3 max-w-3xl text-slate-300">
              {[property?.address, property?.city, property?.state, property?.zip_code].filter(Boolean).join(', ') || 'No address entered yet'}
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium uppercase tracking-wide text-slate-400">
              <span className="rounded-full border border-white/10 px-3 py-1">{String(deal.status || 'draft').replaceAll('_', ' ')}</span>
              <span className="rounded-full border border-white/10 px-3 py-1">{String(deal.property_type || 'Property type pending')}</span>
              <span className="rounded-full border border-white/10 px-3 py-1">{Number(property?.number_of_units || 1)} unit(s)</span>
            </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href={`/deals/${id}/analyzer`} className="rounded-xl bg-white px-5 py-3 text-center font-semibold text-slate-950 transition hover:bg-slate-200">Analyze</Link>
            <Link href={`/deals/${id}/rent-intelligence`} className="rounded-xl border border-white/10 px-5 py-3 text-center font-semibold text-slate-100 transition hover:bg-white/10">Rent Intelligence</Link>
            <Link href={`/deals/${id}/edit`} className="rounded-xl border border-white/10 px-5 py-3 text-center font-semibold text-slate-100 transition hover:bg-white/10">Edit Deal</Link>
            <form action={duplicateDealAction}>
              <input type="hidden" name="deal_id" value={id} />
              <button className="rounded-xl border border-white/10 px-5 py-3 text-center font-semibold text-slate-100 transition hover:bg-white/10" title="Creates a private draft copy of this deal">Duplicate</button>
            </form>
            <Link href="/market" className="rounded-xl border border-white/10 px-5 py-3 text-center font-semibold text-slate-100 transition hover:bg-white/10">Market</Link>
            <Link href="/deals" className="rounded-xl border border-white/10 px-5 py-3 text-center font-semibold text-slate-100 transition hover:bg-white/10">Back</Link>
          </div>
          <form action={publishDealToMarketAction} className="mt-5 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
            <input type="hidden" name="deal_id" value={id} />
            <div className="text-sm font-semibold text-slate-100">Publish to Market / Community</div>
            <p className="mt-1 text-xs leading-5 text-slate-500">Choose where this deal should appear. Team is internal, Community/Public can be premium deal-board posts.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <select name="visibility" defaultValue={publishVisibility} className="rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-white/30">
                <option value="team">Team Market</option>
                <option value="community">Community Deals</option>
                <option value="public">Public Deals</option>
              </select>
              <input name="assignment_fee" type="number" placeholder="Assignment fee, optional" className="rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-white/30" />
              <input name="asking_price" type="number" defaultValue={String(deal.asking_price || deal.purchase_price || '')} placeholder="Asking price" className="rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-white/30" />
              <input name="contact_email" type="email" defaultValue={workspace.user.email || ''} placeholder="Contact email" className="rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-white/30" />
            </div>
            <textarea name="summary" rows={3} placeholder="Short public/community summary. Leave blank to use deal notes." className="mt-3 w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-white/30" />
            <button className="mt-3 w-full rounded-xl bg-emerald-300 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-200">Publish / update Market post</button>
          </form>
          {savedVisibility && savedVisibility !== 'private' ? (
            <form action={unpublishDealAction} className="mt-3 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
              <input type="hidden" name="deal_id" value={id} />
              <div className="text-sm font-semibold text-slate-100">Currently published: {String(savedVisibility)}</div>
              <p className="mt-1 text-xs leading-5 text-slate-500">Unpublishing makes the deal private again and archives its Market listing and community/public posts.</p>
              <button className="mt-3 w-full rounded-xl border border-white/15 px-4 py-3 text-sm font-semibold text-slate-100 hover:bg-white/10">Unpublish from Market</button>
            </form>
          ) : null}
          <form action={archiveDealAction} className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
            <input type="hidden" name="deal_id" value={id} />
            <div className="text-sm font-semibold text-amber-100">Archive this deal</div>
            <p className="mt-1 text-xs leading-5 text-amber-100/80">Marks the deal as dead but keeps all history, files and snapshots. Use this instead of Delete when you want the record for later reference.</p>
            <button className="mt-3 w-full rounded-xl border border-amber-300/30 px-4 py-3 text-sm font-semibold text-amber-100 hover:bg-amber-500/20">Archive Deal</button>
          </form>
          <form action={deleteDealAction} className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
            <input type="hidden" name="deal_id" value={id} />
            <div className="text-sm font-semibold text-red-100">Delete this deal</div>
            <p className="mt-1 text-xs leading-5 text-red-100/80">Permanently removes the deal and related property/calculation records. Prefer Archive if you only want it out of the pipeline. Market posts created from this deal should be archived separately if you want them hidden.</p>
            <button className="mt-3 w-full rounded-xl border border-red-300/30 px-4 py-3 text-sm font-semibold text-red-100 hover:bg-red-500/20">Delete Deal</button>
          </form>
        </div>
        <DealHeroImage deal={deal} heroImageUrl={firstUploadedImage} />
        </section>

        {query?.saved ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">Saved successfully.</div> : null}
        {query?.error ? <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">{publicErrorMessage(query.error)}</div> : null}

        <DealFilesSection dealId={id} files={signedDealFiles} />

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="text-sm text-slate-400">Purchase Price</div>
            <div className="mt-3 text-2xl font-bold">{money(deal.purchase_price)}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="text-sm text-slate-400">ARV</div>
            <div className="mt-3 text-2xl font-bold">{money(deal.arv)}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="text-sm text-slate-400">Market Rent Gap</div>
            <div className={rentGap > 0 ? 'mt-3 text-2xl font-bold text-emerald-300' : 'mt-3 text-2xl font-bold'}>{rentGap ? money(rentGap) + '/mo' : '—'}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="text-sm text-slate-400">HUD Rent Gap</div>
            <div className={hudGap > 0 ? 'mt-3 text-2xl font-bold text-emerald-300' : 'mt-3 text-2xl font-bold'}>{hudGap ? money(hudGap) + '/mo' : '—'}</div>
          </div>
        </section>


        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Quick underwriting inputs</div>
              <h2 className="mt-2 text-xl font-bold">Fill the numbers needed for analysis</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                Use this fast form after creating a deal. It updates the deal without wiping fields you leave blank.
              </p>
            </div>
            <Link href={`/deals/${id}/edit`} className="rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-slate-100 hover:bg-white/10">Full edit</Link>
          </div>
          <form action={quickUpdateDealAssumptionsAction} className="mt-5 grid gap-4 md:grid-cols-3 xl:grid-cols-6">
            <input type="hidden" name="deal_id" value={id} />
            <input type="hidden" name="redirect_to" value={`/deals/${id}`} />
            <QuickField label="Purchase price" name="purchase_price" defaultValue={deal.purchase_price} />
            <QuickField label="Current rent" name="current_rent" defaultValue={deal.current_rent} />
            <QuickField label="Market rent" name="market_rent" defaultValue={deal.market_rent} />
            <QuickField label="HUD rent" name="section8_rent" defaultValue={deal.section8_rent} />
            <QuickField label="Taxes / year" name="taxes_annual" defaultValue={deal.taxes_annual} />
            <QuickField label="Insurance / year" name="insurance_annual" defaultValue={deal.insurance_annual} />
            <QuickField label="Vacancy %" name="vacancy_percent" defaultValue={deal.vacancy_percent} />
            <QuickField label="Management %" name="management_percent" defaultValue={deal.management_percent} />
            <QuickField label="Down payment %" name="down_payment_percent" defaultValue={deal.down_payment_percent} />
            <QuickField label="Interest %" name="interest_rate_percent" defaultValue={deal.interest_rate_percent} />
            <QuickField label="Loan months" name="loan_term_months" defaultValue={deal.loan_term_months} />
            <QuickField label="DSCR target" name="dscr_min_threshold" defaultValue={deal.dscr_min_threshold} />
            <button className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-200 md:col-span-3 xl:col-span-6">Update analysis inputs</button>
          </form>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-xl font-bold">Rent assumptions</h2>
            <dl className="mt-4 text-sm">
              {row('Current rent', money(deal.current_rent))}
              {row('Market rent', money(deal.market_rent))}
              {row('Section 8 / HUD rent', money(deal.section8_rent))}
              {row('Target rent', money(deal.target_rent))}
            </dl>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-xl font-bold">Expense assumptions</h2>
            <dl className="mt-4 text-sm">
              {row('Annual taxes', money(deal.taxes_annual))}
              {row('Annual insurance', money(deal.insurance_annual))}
              {row('Monthly HOA', money(deal.hoa_monthly))}
              {row('Monthly utilities', money(deal.utilities_monthly))}
              {row('Vacancy', percent(deal.vacancy_percent))}
              {row('Management', percent(deal.management_percent))}
            </dl>
          </div>
        </section>

        <FinancialSnapshot deal={deal} property={property} />
      </div>
    </AppShell>
  )
}
