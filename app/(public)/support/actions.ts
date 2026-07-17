'use server'

import { redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { recordAuditEvent } from '@/lib/audit'

const SUPPORT_CATEGORIES = ['billing', 'imports_listings', 'abuse_report', 'account_access', 'other'] as const

type SupportCategory = (typeof SUPPORT_CATEGORIES)[number]

const MAX_MESSAGE_LENGTH = 4000
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000

function toCategory(value: FormDataEntryValue | null): SupportCategory {
  const stringValue = typeof value === 'string' ? value : ''
  return SUPPORT_CATEGORIES.includes(stringValue as SupportCategory) ? (stringValue as SupportCategory) : 'other'
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)
}

export async function submitSupportRequestAction(formData: FormData) {
  const name = String(formData.get('name') || '').trim().slice(0, 200)
  const email = String(formData.get('email') || '').trim().toLowerCase()
  const category = toCategory(formData.get('category'))
  const message = String(formData.get('message') || '').trim().slice(0, MAX_MESSAGE_LENGTH)

  if (!isValidEmail(email)) {
    redirect('/support?error=SUPPORT_INVALID_EMAIL')
  }
  if (!message) {
    redirect('/support?error=SUPPORT_MESSAGE_REQUIRED')
  }

  // Light rate limit: one request per email per 10 minutes. A failed check
  // must not block a legitimate request, so lookup errors only log a warning.
  let recentlySubmitted = false
  try {
    const admin = createSupabaseAdminClient()
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString()
    const { data: recent } = await admin
      .from('audit_logs')
      .select('id')
      .eq('event_type', 'support.request')
      .eq('metadata->>email', email)
      .gte('created_at', windowStart)
      .limit(1)
    recentlySubmitted = Boolean(recent?.length)
  } catch (error) {
    console.warn('[support] rate limit check failed:', error instanceof Error ? error.message : error)
  }
  if (recentlySubmitted) {
    redirect('/support?error=SUPPORT_RATE_LIMIT')
  }

  await recordAuditEvent({
    eventType: 'support.request',
    entityType: 'support_request',
    metadata: {
      name: name || null,
      email,
      category,
      message,
    },
  })

  redirect('/support?success=1')
}
