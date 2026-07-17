import { notFound } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { DealForm } from '@/components/deals/DealForm'
import { deleteDealFileAction, updateDealAction } from '@/app/deals/actions'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { getOrganizationUnderwritingDefaults } from '@/lib/underwriting/defaults'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { formatFileSize } from '@/lib/deals/files'
import { asRows, firstRow, type Row } from '@/lib/types/rows'
import { publicErrorMessage } from '@/lib/errors/public-errors'

function ExistingDealFiles({ dealId, files }: { dealId: string; files: Row[] }) {
  if (!files.length) return null
  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
      <h2 className="text-xl font-bold">Attached files</h2>
      <p className="mt-1 text-sm text-slate-400">These photos and documents are already attached to this deal. New uploads from the form below are added alongside them.</p>
      <ul className="mt-4 grid gap-2">
        {files.map((file) => (
          <li key={String(file.id)} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm">
            <div className="min-w-0">
              <div className="truncate font-semibold text-slate-100">{String(file.file_name)}</div>
              <div className="mt-0.5 text-xs text-slate-500">
                {String(file.file_kind || 'file').toUpperCase()}
                {formatFileSize(file.file_size_bytes) ? ` · ${formatFileSize(file.file_size_bytes)}` : ''}
              </div>
            </div>
            <form action={deleteDealFileAction} className="shrink-0">
              <input type="hidden" name="deal_id" value={dealId} />
              <input type="hidden" name="file_id" value={String(file.id)} />
              <input type="hidden" name="redirect_to" value={`/deals/${dealId}/edit`} />
              <button
                className="rounded-lg border border-red-400/30 bg-red-500/10 px-2.5 py-1 text-xs font-semibold text-red-200 transition hover:bg-red-500/25"
                title="Permanently deletes this file from storage"
              >
                Delete
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default async function EditDealPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params
  const query = await searchParams
  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()
  const assumptionDefaults = await getOrganizationUnderwritingDefaults(workspace.organization?.id)

  const { data: dealData } = workspace.organization?.id
    ? await supabase
        .from('deals')
        .select('*, properties(*)')
        .eq('id', id)
        .eq('organization_id', workspace.organization.id)
        .maybeSingle()
    : { data: null }

  if (!dealData) notFound()
  const deal = dealData as Row
  const property = firstRow(deal.properties)

  const { data: dealFiles } = await supabase
    .from('deal_files')
    .select('id, file_name, file_kind, file_size_bytes')
    .eq('deal_id', id)
    .eq('organization_id', workspace.organization!.id)
    .order('file_kind', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

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
          <h1 className="mt-2 text-3xl font-bold">{String(deal.title)}</h1>
          <p className="mt-3 max-w-3xl text-slate-300">Update property, rent, price and expense assumptions.</p>
        </section>
        {query?.saved === 'file_deleted' ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">File deleted.</div> : null}
        <ExistingDealFiles dealId={id} files={asRows(dealFiles)} />
        <DealForm action={updateDealAction} submitLabel="Save Changes" deal={deal} property={property} error={query?.error ? publicErrorMessage(query.error) : null} assumptionDefaults={assumptionDefaults} />
      </div>
    </AppShell>
  )
}
