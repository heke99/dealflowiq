import { createHash } from 'crypto'
import { headers } from 'next/headers'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export async function requestSecurityMetadata() {
  const values = await headers()
  const forwardedFor = values.get('x-forwarded-for')?.split(',')[0]?.trim() || values.get('x-real-ip') || 'unknown'
  const userAgent = values.get('user-agent') || 'unknown'
  return { ipHash: hash(forwardedFor), userAgentHash: hash(userAgent) }
}

export async function enforceRateLimit(scope: string, key: string, limit: number, windowSeconds: number) {
  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase.rpc('consume_auth_rate_limit', {
    _scope: scope,
    _key_hash: hash(key.toLowerCase()),
    _limit: limit,
    _window_seconds: windowSeconds,
  })
  if (error || data !== true) throw new Error('RATE_LIMITED')
}

export async function verifyCaptcha(token: string | null | undefined) {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return true
  if (!token) return false
  const metadata = await requestSecurityMetadata()
  const body = new URLSearchParams({ secret, response: token })
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
    cache: 'no-store',
  })
  if (!response.ok) return false
  const result = await response.json() as { success?: boolean }
  void metadata // hashes are intentionally available for future security-event correlation
  return result.success === true
}

export async function securityEvent(input: {
  eventType: string
  outcome: 'success' | 'failure' | 'blocked'
  userId?: string | null
  organizationId?: string | null
  metadata?: Record<string, unknown>
}) {
  try {
    const { createSupabaseAdminClient } = await import('@/lib/supabase/admin')
    const request = await requestSecurityMetadata()
    const admin = createSupabaseAdminClient()
    await admin.from('security_events').insert({
      user_id: input.userId || null,
      organization_id: input.organizationId || null,
      event_type: input.eventType,
      outcome: input.outcome,
      ip_hash: request.ipHash,
      user_agent_hash: request.userAgentHash,
      metadata: input.metadata || {},
    })
  } catch (error) {
    console.warn('[security-event] write failed', error instanceof Error ? error.message : error)
  }
}
