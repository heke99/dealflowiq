import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { FinancialSnapshot } from '@/components/deals/FinancialSnapshot'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'

function money(value: number | string | null | undefined) {
  const numberValue = Number(value || 0)
  if (!numberValue) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(numberValue)
}

function percent(value: number | string | null | undefined) {
  const numberValue = Number(value || 0)
  if (!numberValue) return '—'
  return `${numberValue}%`
}

function row(label: string, value: React.ReactNode) {
  return (
    <div className="flex justify-between gap-4 border-b border-white/10 py-3 last:border-b-0">
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-right font-medium text-slate-100">{value}</dd>
    </div>
  )
}

export default async function DealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()

  const { data: deal } = workspace.organization?.id
    ? await supabase
        .from('deals')
        .select('*, properties(*)')
        .eq('id', id)
        .eq('organization_id', workspace.organization.id)
        .maybeSingle()
    : { data: null }

  if (!deal) notFound()

  const property = Array.isArray((deal as any).properties) ? (deal as any).properties[0] : (deal as any).properties
  const currentRent = Number((deal as any).current_rent || 0)
  const marketRent = Number((deal as any).market_rent || 0)
  const hudRent = Number((deal as any).section8_rent || 0)
  const rentGap = marketRent - currentRent
  const hudGap = hudRent - currentRent

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
        <section className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-8 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Deal Detail</div>
            <h1 className="mt-2 text-3xl font-bold">{(deal as any).title}</h1>
            <p className="mt-3 max-w-3xl text-slate-300">
              {[property?.address, property?.city, property?.state, property?.zip_code].filter(Boolean).join(', ') || 'No address entered yet'}
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium uppercase tracking-wide text-slate-400">
              <span className="rounded-full border border-white/10 px-3 py-1">{String((deal as any).status || 'draft').replaceAll('_', ' ')}</span>
              <span className="rounded-full border border-white/10 px-3 py-1">{(deal as any).property_type || 'Property type pending'}</span>
              <span className="rounded-full border border-white/10 px-3 py-1">{property?.number_of_units || 1} unit(s)</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href={`/deals/${id}/analyzer`} className="rounded-xl bg-white px-5 py-3 text-center font-semibold text-slate-950 transition hover:bg-slate-200">Analyze</Link>
            <Link href={`/deals/${id}/rent-intelligence`} className="rounded-xl border border-white/10 px-5 py-3 text-center font-semibold text-slate-100 transition hover:bg-white/10">Rent Intelligence</Link>
            <Link href={`/deals/${id}/edit`} className="rounded-xl border border-white/10 px-5 py-3 text-center font-semibold text-slate-100 transition hover:bg-white/10">Edit Deal</Link>
            <Link href="/deals" className="rounded-xl border border-white/10 px-5 py-3 text-center font-semibold text-slate-100 transition hover:bg-white/10">Back</Link>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="text-sm text-slate-400">Purchase Price</div>
            <div className="mt-3 text-2xl font-bold">{money((deal as any).purchase_price)}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="text-sm text-slate-400">ARV</div>
            <div className="mt-3 text-2xl font-bold">{money((deal as any).arv)}</div>
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

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-xl font-bold">Rent assumptions</h2>
            <dl className="mt-4 text-sm">
              {row('Current rent', money((deal as any).current_rent))}
              {row('Market rent', money((deal as any).market_rent))}
              {row('Section 8 / HUD rent', money((deal as any).section8_rent))}
              {row('Target rent', money((deal as any).target_rent))}
            </dl>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-xl font-bold">Expense assumptions</h2>
            <dl className="mt-4 text-sm">
              {row('Annual taxes', money((deal as any).taxes_annual))}
              {row('Annual insurance', money((deal as any).insurance_annual))}
              {row('Monthly HOA', money((deal as any).hoa_monthly))}
              {row('Monthly utilities', money((deal as any).utilities_monthly))}
              {row('Vacancy', percent((deal as any).vacancy_percent))}
              {row('Management', percent((deal as any).management_percent))}
            </dl>
          </div>
        </section>

        <FinancialSnapshot deal={deal as any} property={property as any} />
      </div>
    </AppShell>
  )
}
