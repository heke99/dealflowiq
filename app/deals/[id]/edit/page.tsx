import { notFound } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { DealForm } from '@/components/deals/DealForm'
import { updateDealAction } from '@/app/deals/actions'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export default async function EditDealPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
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
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-8">
          <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Edit Deal</div>
          <h1 className="mt-2 text-3xl font-bold">{(deal as any).title}</h1>
          <p className="mt-3 max-w-3xl text-slate-300">Update property, rent, price and expense assumptions.</p>
        </section>
        <DealForm action={updateDealAction} submitLabel="Save Changes" deal={deal as any} property={property as any} error={query?.error ? String(query.error) : null} />
      </div>
    </AppShell>
  )
}
