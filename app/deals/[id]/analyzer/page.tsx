import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { FinancialSnapshot } from '@/components/deals/FinancialSnapshot'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export default async function DealAnalyzerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params
  const query = await searchParams
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

  const { data: snapshots } = workspace.organization?.id
    ? await supabase
        .from('deal_calculation_snapshots')
        .select('id, snapshot_name, formula_version, created_at, results')
        .eq('deal_id', id)
        .eq('organization_id', workspace.organization.id)
        .order('created_at', { ascending: false })
        .limit(10)
    : { data: [] }

  const property = Array.isArray((deal as any).properties) ? (deal as any).properties[0] : (deal as any).properties

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
            <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Deal Analyzer</div>
            <h1 className="mt-2 text-3xl font-bold">{(deal as any).title}</h1>
            <p className="mt-3 max-w-3xl text-slate-300">
              Live underwriting view for NOI, cap rate, DSCR, cashflow, rent gaps and early strategy previews.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href={`/deals/${id}/edit`} className="rounded-xl bg-white px-5 py-3 text-center font-semibold text-slate-950 transition hover:bg-slate-200">Edit Inputs</Link>
            <Link href={`/deals/${id}`} className="rounded-xl border border-white/10 px-5 py-3 text-center font-semibold text-slate-100 transition hover:bg-white/10">Back to Deal</Link>
          </div>
        </section>

        <FinancialSnapshot
          deal={deal as any}
          property={property as any}
          showAnalyzerLink={false}
          showSnapshotTools
          snapshots={(snapshots || []) as any}
          message={query?.snapshot === 'saved' ? 'Calculation snapshot saved. Future assumption changes will not alter that saved analysis.' : null}
          error={query?.error ? String(query.error) : null}
        />
      </div>
    </AppShell>
  )
}
