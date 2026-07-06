import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { hasOrganizationRole, MANAGEMENT_ROLES } from '@/lib/auth/access'
import { ACCOUNT_TYPE_CONFIGS } from '@/lib/product/accountTypes'
import { completeOnboardingAction, retryWorkspaceSetupAction, skipOnboardingAction } from '@/app/onboarding/actions'

const STRATEGY_OPTIONS = [
  { value: 'buy_and_hold', label: 'Buy & hold rentals' },
  { value: 'section8', label: 'Section 8 rentals' },
  { value: 'brrrr', label: 'BRRRR' },
  { value: 'fix_and_flip', label: 'Fix & flip' },
  { value: 'wholesale', label: 'Wholesaling' },
  { value: 'seller_finance', label: 'Seller finance' },
  { value: 'mixed', label: 'Mixed strategies' },
]

export default async function OnboardingPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams
  const workspace = await getCurrentWorkspace()

  // Already onboarded users don't need the wizard again.
  if (workspace.profile?.onboarding_completed && !query?.revisit) {
    redirect('/dashboard')
  }

  const canManageWorkspace = hasOrganizationRole(workspace, MANAGEMENT_ROLES)
  const missingOrganization = !workspace.organization

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-12 text-slate-100">
      <div className="mx-auto w-full max-w-3xl">
        <div className="text-sm font-black uppercase tracking-wide text-emerald-300">Welcome to DealFlowIQ</div>
        <h1 className="mt-3 text-4xl font-black tracking-tight">Set up your workspace</h1>
        <p className="mt-3 max-w-2xl text-slate-400">
          A minute of setup makes imports, scoring and matching smarter. Everything here can be changed later in Settings — and you can skip it entirely.
        </p>

        {query?.error ? (
          <div className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">{String(query.error)}</div>
        ) : null}
        {workspace.error ? (
          <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">Workspace setup warning: {workspace.error}</div>
        ) : null}

        {missingOrganization ? (
          <div className="mt-8 rounded-3xl border border-amber-400/30 bg-amber-400/10 p-6">
            <h2 className="text-xl font-bold text-amber-100">Your workspace was not created yet</h2>
            <p className="mt-2 text-sm leading-6 text-amber-100/80">
              Signup succeeded, but the workspace bootstrap did not complete. Retry it now — this is safe to run multiple times.
            </p>
            <form action={retryWorkspaceSetupAction} className="mt-4">
              <input type="hidden" name="return_to" value="/onboarding" />
              <button className="rounded-xl bg-amber-300 px-5 py-3 text-sm font-black text-slate-950 hover:bg-amber-200">Retry workspace setup</button>
            </form>
          </div>
        ) : (
          <form action={completeOnboardingAction} className="mt-8 space-y-6">
            <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xl font-bold">1. What kind of investor are you?</h2>
              <p className="mt-1 text-sm text-slate-500">This tunes default features, calculators and recommended plan.</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {ACCOUNT_TYPE_CONFIGS.map((config) => (
                  <label key={config.value} className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-slate-950/50 p-4 transition hover:border-white/25">
                    <input
                      type="radio"
                      name="account_type"
                      value={config.value}
                      defaultChecked={workspace.access.accountType === config.value}
                      className="mt-1"
                    />
                    <span>
                      <span className="block text-sm font-bold text-slate-100">{config.title}</span>
                      <span className="mt-1 block text-xs leading-5 text-slate-500">{config.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xl font-bold">2. Confirm your workspace</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Workspace name</span>
                  <input
                    name="workspace_name"
                    defaultValue={workspace.organization?.name || ''}
                    disabled={!canManageWorkspace}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-white/30 disabled:opacity-50"
                  />
                  {!canManageWorkspace ? <span className="mt-1 block text-xs text-slate-500">Only workspace owners/admins can rename the workspace.</span> : null}
                </label>
                <label className="block">
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Primary market / location</span>
                  <input
                    name="primary_market"
                    placeholder="e.g. Cleveland, OH"
                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-white/30"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Primary strategy</span>
                  <select name="primary_strategy" defaultValue="" className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-white/30">
                    <option value="">Choose later</option>
                    {STRATEGY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h2 className="text-xl font-bold">3. Pick your first step (optional)</h2>
              <p className="mt-1 text-sm text-slate-500">Finish setup and jump straight into the action that fits you best.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <button name="next" value="buy-box" className="rounded-2xl border border-white/10 bg-slate-950/50 p-4 text-left transition hover:border-white/25">
                  <span className="block text-sm font-bold text-slate-100">Create a buy box</span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">Define criteria so matching listings surface automatically.</span>
                </button>
                <button name="next" value="import" className="rounded-2xl border border-white/10 bg-slate-950/50 p-4 text-left transition hover:border-white/25">
                  <span className="block text-sm font-bold text-slate-100">Import a listing URL</span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">Paste an authorized listing URL and get an instant score.</span>
                </button>
                <button name="next" value="invite" className="rounded-2xl border border-white/10 bg-slate-950/50 p-4 text-left transition hover:border-white/25">
                  <span className="block text-sm font-bold text-slate-100">Invite your team</span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">Send invite codes to teammates or community members.</span>
                </button>
              </div>
            </section>

            <div className="flex flex-wrap items-center gap-3">
              <button className="rounded-2xl bg-white px-6 py-3 text-sm font-black text-slate-950 hover:bg-slate-200">Finish setup</button>
              <button formAction={skipOnboardingAction} formNoValidate className="rounded-2xl border border-white/10 px-6 py-3 text-sm font-bold text-slate-300 hover:bg-white/10">
                Skip for now
              </button>
              <Link href="/dashboard" className="text-sm text-slate-500 hover:text-slate-300">Go to dashboard</Link>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
