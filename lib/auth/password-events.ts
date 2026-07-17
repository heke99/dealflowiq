import { randomUUID } from 'crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Atomically records the password security event and queues its confirmation email.
 * Only the server-side service role can execute the database function.
 */
export async function recordPasswordChangeOrThrow() {
  const eventId = randomUUID()
  const supabase = await createSupabaseServerClient()
  const { data: auth } = await supabase.auth.getUser()
  const user = auth.user
  if (!user?.id) throw new Error('AUTH_REQUIRED')

  const admin = createSupabaseAdminClient()
  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { error } = await admin.rpc('record_password_change_event', {
      _subject_user_id: user.id,
      _event_id: eventId,
    })
    if (!error) return eventId
    lastError = error
  }

  console.error('[password-event] atomic write failed', lastError)
  throw new Error('PASSWORD_EVENT_WRITE_FAILED')
}
