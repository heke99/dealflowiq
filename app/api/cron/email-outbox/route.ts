import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { sendCommunityInviteEmail } from '@/lib/community/inviteEmail'
import { absoluteAppUrl } from '@/lib/config/app-url'
import { sendAccountDeletedEmail, sendPasswordChangedEmail } from '@/lib/email/securityEmail'

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  return Boolean(secret && request.headers.get('authorization') === `Bearer ${secret}`)
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  const supabase = createSupabaseAdminClient()
  const { data: jobs, error } = await supabase.rpc('claim_email_outbox', { _batch_size: 20 })
  if (error) return NextResponse.json({ error: 'OUTBOX_CLAIM_FAILED' }, { status: 500 })

  const results: Array<{ id: string; status: string }> = []
  for (const job of jobs || []) {
    let sent = false
    let failure = 'Unsupported email template'

    if (job.template === 'community_invite') {
      const inviteId = String(job.payload?.invite_id || '')
      const { data: invite } = await supabase.from('community_invites').select('id,invite_code,email,organization_id,team_id,created_by').eq('id', inviteId).maybeSingle()
      if (invite) {
        const [{ data: organization }, { data: team }, { data: inviter }] = await Promise.all([
          supabase.from('organizations').select('name').eq('id', invite.organization_id).maybeSingle(),
          invite.team_id ? supabase.from('community_teams').select('name').eq('id', invite.team_id).eq('organization_id', invite.organization_id).maybeSingle() : Promise.resolve({ data: null }),
          invite.created_by ? supabase.from('profiles').select('email').eq('id', invite.created_by).maybeSingle() : Promise.resolve({ data: null }),
        ])
        const result = await sendCommunityInviteEmail({
          to: job.recipient,
          inviteCode: invite.invite_code,
          inviteUrl: absoluteAppUrl(`/invites/accept?code=${encodeURIComponent(invite.invite_code)}`),
          organizationName: organization?.name || 'DealFlowIQ workspace',
          teamName: team?.name || null,
          inviterEmail: inviter?.email || null,
        })
        sent = result.sent
        failure = result.error || 'Email delivery failed'
        await supabase.from('community_invites').update({
          delivery_status: sent ? 'email_sent' : 'email_failed',
          delivery_error: sent ? null : failure,
        }).eq('id', invite.id)
      } else {
        failure = 'Invite no longer exists'
      }
    } else if (job.template === 'password_changed') {
      const result = await sendPasswordChangedEmail(job.recipient)
      sent = result.sent
      failure = result.error || 'Email delivery failed'
    } else if (job.template === 'account_deleted') {
      const result = await sendAccountDeletedEmail(job.recipient)
      sent = result.sent
      failure = result.error || 'Email delivery failed'
    }

    const attempts = Number(job.attempts || 1)
    const dead = !sent && attempts >= 8
    await supabase.from('email_outbox').update({
      status: sent ? 'sent' : dead ? 'dead_letter' : 'failed',
      sent_at: sent ? new Date().toISOString() : null,
      last_error: sent ? null : failure,
      next_attempt_at: new Date(Date.now() + Math.min(60, 2 ** Math.min(attempts, 6)) * 60_000).toISOString(),
    }).eq('id', job.id)
    results.push({ id: job.id, status: sent ? 'sent' : dead ? 'dead_letter' : 'failed' })
  }

  return NextResponse.json({ processed: results.length, results })
}
