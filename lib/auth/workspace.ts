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
}

export type WorkspaceOrganization = {
  id: string
  name: string
  slug: string | null
  owner_id: string
  organization_type?: string | null
  account_type?: string | null
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

export async function getCurrentWorkspace(): Promise<CurrentWorkspace> {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const { error: rpcError } = await supabase.rpc('create_default_organization')

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, full_name, account_type, organization_name, onboarding_completed')
    .eq('id', user.id)
    .maybeSingle()

  const { data, error } = await supabase
    .from('organization_members')
    .select('id, role, status, organizations(id, name, slug, owner_id, organization_type, account_type)')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: true })

  const memberships = (data || [])
    .map((row: any) => ({
      id: row.id,
      role: row.role,
      status: row.status,
      organization: Array.isArray(row.organizations) ? row.organizations[0] : row.organizations,
    }))
    .filter((row) => Boolean(row.organization)) as WorkspaceMembership[]

  const membership = memberships[0] || null
  const organization = membership?.organization || null
  const accountType = organization?.account_type || organization?.organization_type || (profile as WorkspaceProfile | null)?.account_type || 'solo_investor'
  const access = await getWorkspaceAccess({ organizationId: organization?.id, accountType })

  return {
    user,
    profile: (profile as WorkspaceProfile | null) || null,
    organization,
    membership,
    memberships,
    access,
    error: rpcError?.message || error?.message || null,
  }
}
