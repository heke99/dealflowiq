import { describe, expect, it } from 'vitest'
import { canAcceptInvite, inviteDisplayStatus, type InviteRuleInput } from '@/lib/community/inviteRules'

const NOW = new Date('2026-07-05T12:00:00Z')
const PAST = '2026-07-01T00:00:00Z'
const FUTURE = '2026-08-01T00:00:00Z'

function invite(overrides: Partial<InviteRuleInput> = {}): InviteRuleInput {
  return { status: 'active', expires_at: FUTURE, accepted_count: 0, max_uses: 1, ...overrides }
}

describe('inviteDisplayStatus', () => {
  it('shows a valid active invite as active', () => {
    expect(inviteDisplayStatus(invite(), NOW)).toBe('active')
  })

  it('never expires an invite without expires_at', () => {
    expect(inviteDisplayStatus(invite({ expires_at: null }), NOW)).toBe('active')
  })

  it('shows an active invite past its expiry as expired without a DB write', () => {
    expect(inviteDisplayStatus(invite({ expires_at: PAST }), NOW)).toBe('expired')
    expect(inviteDisplayStatus(invite({ status: 'expired', expires_at: FUTURE }), NOW)).toBe('expired')
  })

  it('lets revoked and accepted statuses win over expiry', () => {
    expect(inviteDisplayStatus(invite({ status: 'revoked', expires_at: PAST }), NOW)).toBe('revoked')
    expect(inviteDisplayStatus(invite({ status: 'accepted', expires_at: PAST }), NOW)).toBe('accepted')
  })

  it('shows an active invite with all uses consumed as exhausted', () => {
    expect(inviteDisplayStatus(invite({ accepted_count: 3, max_uses: 3 }), NOW)).toBe('exhausted')
  })

  it('checks expiry before uses, mirroring the RPC order', () => {
    expect(inviteDisplayStatus(invite({ expires_at: PAST, accepted_count: 5, max_uses: 5 }), NOW)).toBe('expired')
  })
})

describe('canAcceptInvite', () => {
  it('accepts a valid active invite', () => {
    expect(canAcceptInvite(invite(), NOW)).toEqual({ ok: true, reason: null })
    expect(canAcceptInvite(invite({ expires_at: null }), NOW)).toEqual({ ok: true, reason: null })
  })

  it('rejects non-active statuses first (status before expiry)', () => {
    expect(canAcceptInvite(invite({ status: 'revoked', expires_at: PAST }), NOW)).toEqual({ ok: false, reason: 'not_active' })
    expect(canAcceptInvite(invite({ status: 'accepted' }), NOW)).toEqual({ ok: false, reason: 'not_active' })
    expect(canAcceptInvite(invite({ status: 'expired' }), NOW)).toEqual({ ok: false, reason: 'not_active' })
  })

  it('rejects expired invites before checking uses', () => {
    expect(canAcceptInvite(invite({ expires_at: PAST }), NOW)).toEqual({ ok: false, reason: 'expired' })
    expect(canAcceptInvite(invite({ expires_at: PAST, accepted_count: 2, max_uses: 2 }), NOW)).toEqual({ ok: false, reason: 'expired' })
  })

  it('treats expires_at exactly at now as expired (RPC requires expires_at > now)', () => {
    expect(canAcceptInvite(invite({ expires_at: NOW.toISOString() }), NOW)).toEqual({ ok: false, reason: 'expired' })
  })

  it('rejects invites whose uses are exhausted', () => {
    expect(canAcceptInvite(invite({ accepted_count: 1, max_uses: 1 }), NOW)).toEqual({ ok: false, reason: 'exhausted' })
    expect(canAcceptInvite(invite({ accepted_count: 4, max_uses: 3 }), NOW)).toEqual({ ok: false, reason: 'exhausted' })
  })

  it('accepts a multi-use invite with remaining uses', () => {
    expect(canAcceptInvite(invite({ accepted_count: 4, max_uses: 5 }), NOW)).toEqual({ ok: true, reason: null })
  })
})
