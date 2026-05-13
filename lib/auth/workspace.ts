import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/auth/session'

export type WorkspaceOrganization = {
  id: string
  name: string
  slug: string | null
  owner_id: string
}

export type WorkspaceMembership = {
  id: string
  role: string
  status: string
  organization: WorkspaceOrganization
}

export async function getCurrentWorkspace() {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const { error: rpcError } = await supabase.rpc('create_default_organization')

  if (rpcError) {
    return {
      user,
      organization: null,
      membership: null,
      memberships: [],
      error: rpcError.message,
    }
  }

  const { data, error } = await supabase
    .from('organization_members')
    .select('id, role, status, organizations(id, name, slug, owner_id)')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: true })

  if (error) {
    return {
      user,
      organization: null,
      membership: null,
      memberships: [],
      error: error.message,
    }
  }

  const memberships = (data || [])
    .map((row: any) => ({
      id: row.id,
      role: row.role,
      status: row.status,
      organization: Array.isArray(row.organizations) ? row.organizations[0] : row.organizations,
    }))
    .filter((row) => Boolean(row.organization)) as WorkspaceMembership[]

  const membership = memberships[0] || null

  return {
    user,
    organization: membership?.organization || null,
    membership,
    memberships,
    error: null,
  }
}
