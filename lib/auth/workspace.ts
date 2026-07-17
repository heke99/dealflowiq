import { cache } from 'react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/auth/session'
import { getWorkspaceAccess, type WorkspaceAccess } from '@/lib/billing/access'

export type WorkspaceProfile = {
  id: string
  email: string | null
  full_name: string | null
  account_type: string | null
  organization_name: string | null
  onboarding_completed: boolean
  onboarding_completed_at: string | null
  onboarding_skipped_at: string | null
  onboarding_version: number
  active_organization_id: string | null
}

export type WorkspaceOrganization = {
  id: string
  name: string
  slug: string | null
  owner_id: string
  organization_type?: string | null
  account_type?: string | null
  primary_market?: string | null
  primary_strategy?: string | null
}

export type WorkspaceMembership = {
  id: string
  role: string
  status: string
  organization: WorkspaceOrganization
}

export type CurrentWorkspace = {
  user: Awaited<ReturnType<typeof requireUser>>
  profile: WorkspaceProfile | null
  organization: WorkspaceOrganization | null
  membership: WorkspaceMembership | null
  memberships: WorkspaceMembership[]
  access: WorkspaceAccess
  error: string | null
}

/** Read-only and request-memoized. Bootstrap is an explicit auth/recovery action. */
export const getCurrentWorkspace = cache(async (): Promise<CurrentWorkspace> => {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const { data: profileData, error: profileError } = await supabase
    .from('profiles')
    .select('id,email,full_name,account_type,organization_name,onboarding_completed,onboarding_completed_at,onboarding_skipped_at,onboarding_version,active_organization_id')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError) {
    return {
      user,
      profile: null,
      organization: null,
      membership: null,
      memberships: [],
      access: await getWorkspaceAccess({ userId: user.id, accountType: 'solo_investor' }),
      error: 'PROFILE_READ_FAILED',
    }
  }

  const profile = (profileData as WorkspaceProfile | null) || null
  const { data, error: membershipsError } = await supabase
    .from('organization_members')
    .select('id,role,status,created_at,organizations(id,name,slug,owner_id,organization_type,account_type,primary_market,primary_strategy)')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: true })

  const memberships = (data || [])
    .map((row) => ({
      id: row.id,
      role: row.role,
      status: row.status,
      organization: (Array.isArray(row.organizations) ? row.organizations[0] : row.organizations) as WorkspaceOrganization | null,
    }))
    .filter((row): row is WorkspaceMembership & { organization: WorkspaceOrganization } => Boolean(row.organization))

  const membership = memberships.find((item) => item.organization.id === profile?.active_organization_id) || memberships[0] || null
  const organization = membership?.organization || null
  const accountType = organization?.account_type || organization?.organization_type || profile?.account_type || 'solo_investor'
  const access = await getWorkspaceAccess({ organizationId: organization?.id, accountType, userId: user.id })

  return {
    user,
    profile,
    organization,
    membership,
    memberships,
    access,
    error: membershipsError ? 'MEMBERSHIP_READ_FAILED' : profile ? null : 'PROFILE_MISSING',
  }
})
