import { AppShell } from '@/components/layout/AppShell'
import { createAdminAccessInviteAction, revokeAdminAccessInviteAction } from '@/app/admin/access/actions'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ACCOUNT_TYPE_CONFIGS } from '@/lib/product/accountTypes'
import { FEATURE_KEYS, featureLabels } from '@/lib/billing/features'

type AdminAccessPageProps = {
  searchParams?: Promise<{ error?: string; saved?: string }> | { error?: string; saved?: string }
}

const roles = [
  ['owner', 'Owner'],
  ['admin', 'Admin'],
  ['acquisition_manager', 'Acquisition Manager'],
  ['disposition_manager', 'Disposition Manager'],
  ['member', 'Member'],
  ['buyer', 'Buyer'],
  ['viewer', 'Viewer'],
]

export default async function AdminAccessPage({ searchParams }: AdminAccessPageProps) {
  const params = await Promise.resolve(searchParams || {})
  const workspace = await getCurrentWorkspace()
  const supabase = await createSupabaseServerClient()

  if (!workspace.access.isPlatformAdmin) {
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
        <div className="rounded-3xl border border-amber-500/30 bg-amber-500/10 p-8 text-amber-100">
          <h1 className="text-3xl font-bold">Platform admin required</h1>
          <p className="mt-3 text-sm">Only platform admins can create access invites and manual grants.</p>
        </div>
      </AppShell>
    )
  }

  const { data: plans } = await supabase.from('billing_plans').select('id, name, code, is_active').eq('is_active', true).order('display_order')
  const { data: invites } = await supabase
    .from('admin_access_invites')
    .select('id, email, organization_name, account_type, role, trial_days, status, invite_token, expires_at, used_at, created_at, billing_plans(name, code)')
    .order('created_at', { ascending: false })
    .limit(30)

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
      <div className="space-y-8">
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-8">
          <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Platform Admin</div>
          <h1 className="mt-2 text-3xl font-bold">Access Invites & Manual Grants</h1>
          <p className="mt-3 max-w-3xl text-slate-300">
            Invite a user by email and predefine account type, role, plan, role, feature overrides and limits. When that email signs up or logs in, the access grant is applied to their workspace automatically.
          </p>
          {params.error ? <div className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">{params.error}</div> : null}
          {params.saved ? <div className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">Saved.</div> : null}
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-xl font-bold">Create invite / access grant</h2>
            <form action={createAdminAccessInviteAction} className="mt-6 space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm"><span className="text-slate-300">Email</span><input name="email" type="email" required className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 outline-none focus:border-white/30" placeholder="investor@example.com" /></label>
                <label className="block text-sm"><span className="text-slate-300">Workspace / company name</span><input name="organization_name" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 outline-none focus:border-white/30" placeholder="Optional" /></label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm"><span className="text-slate-300">Account type</span><select name="account_type" defaultValue="solo_investor" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3">{ACCOUNT_TYPE_CONFIGS.map((item) => <option key={item.value} value={item.value}>{item.title}</option>)}</select></label>
                <label className="block text-sm"><span className="text-slate-300">Role</span><select name="role" defaultValue="owner" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3">{roles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              </div>

              <input type="hidden" name="trial_days" value="0" />
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm"><span className="text-slate-300">Plan</span><select name="plan_id" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3"><option value="">Default by account type</option>{(plans || []).map((plan: any) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>
                <label className="block text-sm"><span className="text-slate-300">Invite expires in days</span><input name="expires_in_days" type="number" min="0" defaultValue="30" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
              </div>

              <div>
                <div className="text-sm font-semibold">Feature overrides</div>
                <p className="mt-1 text-xs text-slate-500">Checked features are explicitly granted on top of the selected plan.</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {FEATURE_KEYS.filter((feature) => feature !== 'admin_plan_management').map((feature) => (
                    <label key={feature} className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm">
                      <input name={`feature_${feature}`} type="checkbox" /> {featureLabels[feature]}
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block text-sm"><span className="text-slate-300">Max deals override</span><input name="max_deals" type="number" min="0" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
                <label className="block text-sm"><span className="text-slate-300">Max buyers override</span><input name="max_buyers" type="number" min="0" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
                <label className="block text-sm"><span className="text-slate-300">Team members override</span><input name="max_team_members" type="number" min="0" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" /></label>
              </div>

              <label className="block text-sm"><span className="text-slate-300">Admin notes</span><textarea name="notes" rows={3} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3" placeholder="Why this person gets access." /></label>
              <button className="w-full rounded-xl bg-white px-5 py-3 font-semibold text-slate-950 hover:bg-slate-200">Create access invite</button>
            </form>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-xl font-bold">Recent invites</h2>
            <div className="mt-5 space-y-3">
              {(invites || []).map((invite: any) => {
                const plan = Array.isArray(invite.billing_plans) ? invite.billing_plans[0] : invite.billing_plans
                return (
                  <div key={invite.id} className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="font-semibold">{invite.email}</div>
                        <div className="mt-1 text-xs text-slate-500">{invite.account_type} · {invite.role} · {plan?.name || 'default plan'}</div>
                        <div className="mt-2 text-xs text-slate-500">Token: {invite.invite_token}</div>
                      </div>
                      <div className="rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-wide text-slate-300">{invite.status}</div>
                    </div>
                    {invite.status === 'active' ? (
                      <form action={revokeAdminAccessInviteAction} className="mt-4">
                        <input type="hidden" name="id" value={invite.id} />
                        <button className="rounded-lg border border-red-500/30 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/10">Revoke</button>
                      </form>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  )
}
