import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { authErrorMessage } from '@/lib/errors/auth-errors'

export default async function InviteResultPage({ searchParams }: { searchParams?: Promise<{ status?: string }> }) {
  const params = await searchParams
  const workspace = await getCurrentWorkspace()
  const accepted = params?.status === 'ACCEPTED'
  const needsOnboarding = workspace.profile?.onboarding_completed !== true
  return (
    <AppShell organizationName={workspace.organization?.name} userEmail={workspace.user.email} accountType={workspace.access.accountType} features={workspace.access.features} subscriptionStatus={workspace.access.status} planName={workspace.access.plan?.name} trialEndsAt={workspace.access.trialEndsAt} isPlatformAdmin={workspace.access.isPlatformAdmin}>
      <div className="mx-auto max-w-2xl rounded-3xl border border-white/10 bg-white/[0.03] p-8">
        <h1 className="text-3xl font-black">{accepted ? 'Invite accepted' : 'Invite not accepted'}</h1>
        <p className="mt-4 text-slate-300">{accepted ? `You are now working in ${workspace.organization?.name || 'the invited workspace'}.` : authErrorMessage(params?.status || 'INVITE_ACCEPTANCE_FAILED')}</p>
        <div className="mt-6 flex gap-3"><Link href={needsOnboarding ? '/onboarding' : '/dashboard'} className="rounded-xl bg-white px-4 py-3 font-bold text-slate-950">{needsOnboarding ? 'Continue setup' : 'Open dashboard'}</Link><Link href="/settings" className="rounded-xl border border-white/10 px-4 py-3 font-bold">Workspace settings</Link></div>
      </div>
    </AppShell>
  )
}
