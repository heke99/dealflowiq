/**
 * Pure invite state rules shared by the community UI and tests.
 *
 * These mirror the validation inside the accept_community_invite RPC
 * (017/037 migrations): status is checked first, then expiry, then uses.
 * Keeping this logic pure lets the community page label invites (for
 * example an 'active' row whose expires_at has passed renders as Expired)
 * without any database writes.
 */

export type InviteRuleInput = {
  status: string
  expires_at: string | null
  accepted_count: number
  max_uses: number
}

export type InviteDisplayStatus = 'active' | 'expired' | 'revoked' | 'accepted' | 'exhausted'

export type InviteAcceptReason = 'not_active' | 'expired' | 'exhausted'

export type InviteAcceptCheck = { ok: boolean; reason: InviteAcceptReason | null }

function isExpired(expiresAt: string | null, now: Date): boolean {
  if (!expiresAt) return false
  const at = new Date(expiresAt).getTime()
  // The RPC treats an invite as valid only while expires_at > now().
  return Number.isFinite(at) && at <= now.getTime()
}

export function inviteDisplayStatus(invite: InviteRuleInput, now: Date = new Date()): InviteDisplayStatus {
  if (invite.status === 'revoked') return 'revoked'
  if (invite.status === 'accepted') return 'accepted'
  if (invite.status === 'expired' || isExpired(invite.expires_at, now)) return 'expired'
  if (invite.accepted_count >= invite.max_uses) return 'exhausted'
  return 'active'
}

export function canAcceptInvite(invite: InviteRuleInput, now: Date = new Date()): InviteAcceptCheck {
  if (invite.status !== 'active') return { ok: false, reason: 'not_active' }
  if (isExpired(invite.expires_at, now)) return { ok: false, reason: 'expired' }
  if (invite.accepted_count >= invite.max_uses) return { ok: false, reason: 'exhausted' }
  return { ok: true, reason: null }
}
