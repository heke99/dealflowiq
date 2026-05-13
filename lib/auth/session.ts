import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export async function getCurrentUser() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) return null
  return user
}

export async function requireUser() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  return user
}
