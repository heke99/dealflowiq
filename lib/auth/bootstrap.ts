import { createSupabaseServerClient } from '@/lib/supabase/server'

export async function bootstrapCurrentUser(inviteCode?: string | null) {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('bootstrap_current_user', {
    _invite_code: inviteCode || null,
  })
  if (error) throw error
  return data as { organization_id?: string; onboarding_completed?: boolean } | null
}
