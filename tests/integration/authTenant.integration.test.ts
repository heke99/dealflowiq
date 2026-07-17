import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_TEST_URL || ''
const anonKey = process.env.SUPABASE_TEST_ANON_KEY || ''
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY || ''

if (!url || !anonKey || !serviceKey) {
  throw new Error('SUPABASE_TEST_URL, SUPABASE_TEST_ANON_KEY and SUPABASE_TEST_SERVICE_ROLE_KEY are required')
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url) && process.env.ALLOW_REMOTE_TEST_DB !== 'YES') {
  throw new Error('Integration tests refuse a remote database unless ALLOW_REMOTE_TEST_DB=YES')
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
let owner: SupabaseClient
let member: SupabaseClient
let ownerId = ''
let memberId = ''
let organizationId = ''
const password = 'Integration-Test-Password-2026!'
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
const ownerEmail = `owner-${suffix}@example.test`
const memberEmail = `member-${suffix}@example.test`

async function authenticatedClient(email: string) {
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  return client
}

describe.sequential('auth and tenant integration', () => {
  beforeAll(async () => {
    const ownerResult = await admin.auth.admin.createUser({ email: ownerEmail, password, email_confirm: true })
    const memberResult = await admin.auth.admin.createUser({ email: memberEmail, password, email_confirm: true })
    if (ownerResult.error) throw ownerResult.error
    if (memberResult.error) throw memberResult.error
    ownerId = ownerResult.data.user.id
    memberId = memberResult.data.user.id
    const { error: legalError } = await admin.from('legal_acceptances').insert([
      { user_id: ownerId, document_type: 'terms', document_version: '2026-07-17' },
      { user_id: ownerId, document_type: 'privacy', document_version: '2026-07-17' },
      { user_id: memberId, document_type: 'terms', document_version: '2026-07-17' },
      { user_id: memberId, document_type: 'privacy', document_version: '2026-07-17' },
    ])
    if (legalError) throw legalError
    owner = await authenticatedClient(ownerEmail)
    member = await authenticatedClient(memberEmail)
  })

  afterAll(async () => {
    if (organizationId) await admin.from('organizations').delete().eq('id', organizationId)
    if (ownerId) await admin.auth.admin.deleteUser(ownerId)
    if (memberId) await admin.auth.admin.deleteUser(memberId)
  })

  it('bootstraps exactly one workspace under concurrency', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => owner.rpc('bootstrap_current_user', { _invite_code: null })))
    for (const result of results) expect(result.error).toBeNull()
    const ids = new Set(results.map((result) => String((result.data as { organization_id: string }).organization_id)))
    expect(ids.size).toBe(1)
    organizationId = [...ids][0]

    const { count } = await admin.from('organizations').select('id', { count: 'exact', head: true }).eq('owner_id', ownerId)
    expect(count).toBe(1)
    const { data: profile } = await admin.from('profiles').select('onboarding_completed,active_organization_id').eq('id', ownerId).single()
    expect(profile?.onboarding_completed).toBe(false)
    expect(profile?.active_organization_id).toBe(organizationId)
  })


  it('rejects owner invites outside the transfer flow', async () => {
    const result = await owner.rpc('create_community_invite', {
      _email: `other-${suffix}@example.test`,
      _full_name: null,
      _team_id: null,
      _role: 'owner',
      _max_uses: 1,
      _expires_in_days: 7,
      _queue_email: false,
    })
    expect(result.error).not.toBeNull()
    expect(result.error?.message).toContain('OWNERSHIP_TRANSFER_REQUIRED')
  })

  it('accepts an invite idempotently without changing billing', async () => {
    const { data: subscriptionBefore, count: subscriptionCountBefore } = await admin
      .from('organization_subscriptions')
      .select('id,status,plan_id', { count: 'exact' })
      .eq('organization_id', organizationId)
      .single()

    const created = await owner.rpc('create_community_invite', {
      _email: memberEmail,
      _full_name: 'Integration Member',
      _team_id: null,
      _role: 'member',
      _max_uses: 5,
      _expires_in_days: 7,
      _queue_email: false,
    })
    expect(created.error).toBeNull()
    const invite = created.data as { id: string; invite_code: string }

    const accepted = await Promise.all([
      member.rpc('accept_community_invite', { _invite_code: invite.invite_code }),
      member.rpc('accept_community_invite', { _invite_code: invite.invite_code }),
    ])
    for (const result of accepted) {
      expect(result.error).toBeNull()
      expect(result.data).toBe(organizationId)
    }

    const { data: inviteRow } = await admin.from('community_invites').select('accepted_count').eq('id', invite.id).single()
    const { count } = await admin.from('community_invite_acceptances').select('id', { count: 'exact', head: true }).eq('invite_id', invite.id).eq('user_id', memberId)
    expect(inviteRow?.accepted_count).toBe(1)
    expect(count).toBe(1)

    const { data: subscriptionAfter, count: subscriptionCountAfter } = await admin
      .from('organization_subscriptions')
      .select('id,status,plan_id', { count: 'exact' })
      .eq('organization_id', organizationId)
      .single()
    expect(subscriptionCountBefore).toBe(1)
    expect(subscriptionCountAfter).toBe(1)
    expect(subscriptionAfter).toEqual(subscriptionBefore)
  })

  it('does not downgrade an existing higher role', async () => {
    await admin.from('organization_members').update({ role: 'admin' }).eq('organization_id', organizationId).eq('user_id', memberId)
    const created = await owner.rpc('create_community_invite', {
      _email: memberEmail,
      _full_name: null,
      _team_id: null,
      _role: 'viewer',
      _max_uses: 1,
      _expires_in_days: 7,
      _queue_email: false,
    })
    const invite = created.data as { invite_code: string }
    const accepted = await member.rpc('accept_community_invite', { _invite_code: invite.invite_code })
    expect(accepted.error).toBeNull()
    const { data: membership } = await admin.from('organization_members').select('role').eq('organization_id', organizationId).eq('user_id', memberId).single()
    expect(membership?.role).toBe('admin')
  })

  it('completes onboarding atomically', async () => {
    const result = await owner.rpc('complete_user_onboarding', {
      _full_name: 'Integration Owner',
      _account_type: 'solo_investor',
      _workspace_name: 'Integration Workspace',
      _primary_market: 'Malmö',
      _primary_strategy: 'buy_and_hold',
      _onboarding_version: 1,
    })
    expect(result.error).toBeNull()
    const { data: profile } = await admin.from('profiles').select('onboarding_completed,onboarding_completed_at').eq('id', ownerId).single()
    expect(profile?.onboarding_completed).toBe(true)
    expect(profile?.onboarding_completed_at).toBeTruthy()
  })

  it('transfers ownership only through the controlled function', async () => {
    const directUpdate = await admin.from('organizations').update({ owner_id: memberId }).eq('id', organizationId)
    expect(directUpdate.error).not.toBeNull()
    expect(directUpdate.error?.message).toContain('OWNERSHIP_TRANSFER_REQUIRED')

    const result = await owner.rpc('transfer_organization_ownership', { _organization_id: organizationId, _new_owner_user_id: memberId })
    expect(result.error).toBeNull()
    const [{ data: organization }, { data: roles }] = await Promise.all([
      admin.from('organizations').select('owner_id').eq('id', organizationId).single(),
      admin.from('organization_members').select('user_id,role').eq('organization_id', organizationId),
    ])
    expect(organization?.owner_id).toBe(memberId)
    const roleByUser = new Map((roles || []).map((row) => [row.user_id, row.role]))
    expect(roleByUser.get(ownerId)).toBe('admin')
    expect(roleByUser.get(memberId)).toBe('owner')
    const { count: activeOwnerCount } = await admin
      .from('organization_members')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('role', 'owner')
      .eq('status', 'active')
    expect(activeOwnerCount).toBe(1)
  })
})
