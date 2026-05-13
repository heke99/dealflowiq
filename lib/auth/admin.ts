import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/session'

export async function isCurrentUserPlatformAdmin() {
  const user = await getCurrentUser()
  if (!user) return false

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) return false
  return Boolean(data)
}

export async function requirePlatformAdmin() {
  const isAdmin = await isCurrentUserPlatformAdmin()
  if (!isAdmin) throw new Error('Platform admin access required.')
  return true
}
