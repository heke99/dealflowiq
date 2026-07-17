import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { ACCOUNT_TYPE_CONFIGS } from '@/lib/product/accountTypes'
import { changePasswordAction, deleteAccountAction, transferOwnershipAction, updateWorkspaceSettingsAction } from '@/app/settings/actions'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { asRows, rowString } from '@/lib/types/rows'
import { publicErrorMessage } from '@/lib/errors/public-errors'

const strategies = [
  ['','Choose later'],['buy_and_hold','Buy & hold'],['section8','Section 8'],['brrrr','BRRRR'],
  ['fix_and_flip','Fix & flip'],['wholesale','Wholesale'],['seller_finance','Seller finance'],['mixed','Mixed'],
]

export default async function SettingsPage({ searchParams }: { searchParams?: Promise<{ error?: string; message?: string }> }) {
  const params = await searchParams
  const workspace = await getCurrentWorkspace()
  const canManage = ['owner','admin'].includes(workspace.membership?.role || '') || workspace.access.isPlatformAdmin
  const isOwner = workspace.membership?.role === 'owner'
  const supabase = await createSupabaseServerClient()
  let ownershipCandidates: Array<{ id: string; label: string }> = []
  if (isOwner && workspace.organization?.id) {
    const { data: members } = await supabase.from('organization_members').select('user_id,role,status').eq('organization_id', workspace.organization.id).eq('status','active').neq('user_id', workspace.user.id)
    const ids = asRows(members).map((member) => rowString(member.user_id)).filter((id): id is string => Boolean(id))
    const { data: profiles } = ids.length ? await supabase.from('profiles').select('id,email,full_name').in('id', ids) : { data: [] }
    const profileMap = new Map(asRows(profiles).map((profile) => [rowString(profile.id), profile]))
    ownershipCandidates = ids.map((id) => {
      const profile = profileMap.get(id)
      return { id, label: rowString(profile?.full_name) || rowString(profile?.email) || id }
    })
  }

  return (
    <AppShell organizationName={workspace.organization?.name} userEmail={workspace.user.email} accountType={workspace.access.accountType} features={workspace.access.features} subscriptionStatus={workspace.access.status} planName={workspace.access.plan?.name} trialEndsAt={workspace.access.trialEndsAt} isPlatformAdmin={workspace.access.isPlatformAdmin}>
      <div className="space-y-6">
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8">
          <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Profile and workspace</div>
          <h1 className="mt-2 text-3xl font-bold">Settings</h1>
          <p className="mt-3 max-w-2xl text-slate-300">The fields collected during onboarding are editable here. Sensitive changes are server-validated and audited.</p>
          {params?.error ? <div className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">{publicErrorMessage(params.error)}</div> : null}
          {params?.message ? <div className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">Settings saved.</div> : null}
        </div>

        <form action={updateWorkspaceSettingsAction} className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-xl font-bold">Personal profile</h2>
            <div className="mt-5 space-y-4">
              <label className="block"><span className="text-sm text-slate-400">Full name</span><input name="full_name" required minLength={2} maxLength={120} defaultValue={workspace.profile?.full_name || ''} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
              <label className="block"><span className="text-sm text-slate-400">Email</span><input value={workspace.user.email || ''} readOnly className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/50 px-4 py-3 text-slate-500" /></label>
              <label className="block"><span className="text-sm text-slate-400">Account type</span><select name="account_type" defaultValue={workspace.access.accountType} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3">{ACCOUNT_TYPE_CONFIGS.map((item) => <option key={item.value} value={item.value}>{item.title}</option>)}</select></label>
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-xl font-bold">Active workspace</h2>
            <div className="mt-5 space-y-4">
              <label className="block"><span className="text-sm text-slate-400">Workspace name</span><input name="workspace_name" required={canManage} minLength={2} maxLength={120} disabled={!canManage} defaultValue={workspace.organization?.name || ''} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 disabled:opacity-50" /></label>
              <label className="block"><span className="text-sm text-slate-400">Primary market</span><input name="primary_market" maxLength={120} disabled={!canManage} defaultValue={workspace.organization?.primary_market || ''} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 disabled:opacity-50" /></label>
              <label className="block"><span className="text-sm text-slate-400">Primary strategy</span><select name="primary_strategy" disabled={!canManage} defaultValue={workspace.organization?.primary_strategy || ''} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 disabled:opacity-50">{strategies.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3 text-sm text-slate-400">Role: <strong className="capitalize text-white">{workspace.membership?.role?.replaceAll('_',' ')}</strong></div>
            </div>
          </section>
          <div className="lg:col-span-2"><button className="rounded-xl bg-white px-6 py-3 font-black text-slate-950 hover:bg-slate-200">Save settings</button></div>
        </form>

        <section className="grid gap-6 lg:grid-cols-2">
          <form action={changePasswordAction} className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-xl font-bold">Security and password</h2>
            <p className="mt-2 text-sm text-slate-400">Changing a password requires the current password. A security event and confirmation email are queued after the change.</p>
            <div className="mt-5 space-y-4">
              <label className="block"><span className="text-sm text-slate-400">Current password</span><input name="current_password" type="password" required autoComplete="current-password" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
              <label className="block"><span className="text-sm text-slate-400">New password</span><input name="new_password" type="password" required minLength={12} autoComplete="new-password" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
              <label className="block"><span className="text-sm text-slate-400">Confirm new password</span><input name="confirm_password" type="password" required minLength={12} autoComplete="new-password" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
              <button className="rounded-xl bg-white px-5 py-3 font-black text-slate-950 hover:bg-slate-200">Change password</button>
            </div>
          </form>

          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-xl font-bold">Ownership transfer</h2>
            {isOwner ? (
              <form action={transferOwnershipAction} className="mt-5 space-y-4">
                <input type="hidden" name="organization_id" value={workspace.organization?.id || ''} />
                <p className="text-sm text-slate-400">Transfer is atomic. The recipient must already be an active member. Your role becomes admin after transfer.</p>
                <label className="block"><span className="text-sm text-slate-400">New owner</span><select name="new_owner_user_id" required className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3"><option value="">Select an active member</option>{ownershipCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}</select></label>
                <label className="block"><span className="text-sm text-slate-400">Confirm with current password</span><input name="current_password" type="password" required autoComplete="current-password" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
                <button disabled={!ownershipCandidates.length} className="rounded-xl border border-amber-400/30 px-5 py-3 font-bold text-amber-100 disabled:cursor-not-allowed disabled:opacity-50">Transfer ownership</button>
              </form>
            ) : <p className="mt-4 text-sm text-slate-400">Only the current owner can transfer workspace ownership.</p>}
          </div>
        </section>

        <section className="rounded-3xl border border-red-500/25 bg-red-500/[0.06] p-6">
          <h2 className="text-xl font-bold text-red-100">Delete account</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-red-100/70">Deleting your login removes your memberships and personal profile. It never deletes a workspace you own. Transfer ownership or explicitly close that workspace first.</p>
          <form action={deleteAccountAction} className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="block"><span className="text-sm text-red-100/80">Current password</span><input name="current_password" type="password" required autoComplete="current-password" className="mt-2 w-full rounded-xl border border-red-400/20 bg-slate-950 px-4 py-3" /></label>
            <label className="block"><span className="text-sm text-red-100/80">Type DELETE</span><input name="confirmation" required pattern="DELETE" className="mt-2 w-full rounded-xl border border-red-400/20 bg-slate-950 px-4 py-3" /></label>
            <div className="md:col-span-2"><button className="rounded-xl border border-red-400/40 px-5 py-3 font-black text-red-100 hover:bg-red-500/10">Permanently delete my account</button></div>
          </form>
        </section>
      </div>
    </AppShell>
  )
}
