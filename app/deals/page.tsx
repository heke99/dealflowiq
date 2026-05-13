import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'

function money(value: number | string | null | undefined) {
  const numberValue = Number(value || 0)
  if (!numberValue) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(numberValue)
}

function statusLabel(value: string | null | undefined) {
  return String(value || 'draft').replaceAll('_', ' ')
}

export default async function DealsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()

  const { data: deals, error } = workspace.organization?.id
    ? await supabase
        .from('deals')
        .select('id, title, status, property_type, purchase_price, arv, current_rent, market_rent, section8_rent, created_at, properties(address, city, state, zip_code, number_of_units)')
        .eq('organization_id', workspace.organization.id)
        .order('created_at', { ascending: false })
    : { data: [], error: null }

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
        <section className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Batch 3</div>
            <h1 className="mt-2 text-3xl font-bold">Deals</h1>
            <p className="mt-3 max-w-3xl text-slate-300">
              Every account type can create and analyze deals. Account type personalizes the workflow; subscription plans control premium features and limits.
            </p>
            {error ? <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">{error.message}</div> : null}
            {params?.error ? <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">{String(params.error)}</div> : null}
          </div>
          <Link href="/deals/new" className="rounded-xl bg-white px-5 py-3 text-center font-semibold text-slate-950 transition hover:bg-slate-200">
            Create Deal
          </Link>
        </section>

        {deals?.length ? (
          <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
            <div className="grid border-b border-white/10 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 md:grid-cols-[1.4fr_0.9fr_0.8fr_0.8fr_0.8fr]">
              <div>Deal</div>
              <div className="hidden md:block">Location</div>
              <div className="hidden md:block">Price</div>
              <div className="hidden md:block">Rent Gap</div>
              <div className="hidden md:block">Status</div>
            </div>
            {deals.map((deal: any) => {
              const property = Array.isArray(deal.properties) ? deal.properties[0] : deal.properties
              const rentGap = Number(deal.market_rent || 0) - Number(deal.current_rent || 0)
              return (
                <Link key={deal.id} href={`/deals/${deal.id}`} className="grid gap-3 border-b border-white/10 px-5 py-4 transition last:border-b-0 hover:bg-white/[0.04] md:grid-cols-[1.4fr_0.9fr_0.8fr_0.8fr_0.8fr] md:items-center">
                  <div>
                    <div className="font-semibold">{deal.title}</div>
                    <div className="mt-1 text-sm text-slate-500">{deal.property_type || 'Property type pending'} · {property?.number_of_units || 1} unit(s)</div>
                  </div>
                  <div className="text-sm text-slate-300">{[property?.city, property?.state, property?.zip_code].filter(Boolean).join(', ') || property?.address || 'Location pending'}</div>
                  <div className="text-sm text-slate-300">{money(deal.purchase_price)}</div>
                  <div className={rentGap > 0 ? 'text-sm text-emerald-300' : 'text-sm text-slate-400'}>{rentGap ? money(rentGap) + '/mo' : '—'}</div>
                  <div className="text-sm capitalize text-slate-300">{statusLabel(deal.status)}</div>
                </Link>
              )
            })}
          </section>
        ) : (
          <section className="rounded-3xl border border-dashed border-white/15 bg-white/[0.02] p-10 text-center">
            <h2 className="text-2xl font-bold">Create your first deal</h2>
            <p className="mx-auto mt-3 max-w-2xl text-slate-400">
              Start with manual inputs. Market rent, Section 8, calculators and projections will attach to this deal record in the next batches.
            </p>
            <Link href="/deals/new" className="mt-6 inline-flex rounded-xl bg-white px-5 py-3 font-semibold text-slate-950 transition hover:bg-slate-200">
              New Deal
            </Link>
          </section>
        )}
      </div>
    </AppShell>
  )
}
