export type CommunityInviteEmailInput = {
  to: string
  inviteCode: string
  inviteUrl: string
  organizationName: string
  teamName?: string | null
  inviterEmail?: string | null
}

export async function sendCommunityInviteEmail(input: CommunityInviteEmailInput): Promise<{ sent: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.COMMUNITY_INVITE_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || 'DealFlowIQ <noreply@dealflowiq.com>'

  if (!apiKey) {
    return { sent: false, error: 'RESEND_API_KEY is not configured. Invite code and link were created for manual sharing.' }
  }

  const subject = `You are invited to join ${input.organizationName} on DealFlowIQ`
  const teamLine = input.teamName ? `<p>You will be added to the <strong>${escapeHtml(input.teamName)}</strong> team.</p>` : ''
  const inviterLine = input.inviterEmail ? `<p>Invited by ${escapeHtml(input.inviterEmail)}.</p>` : ''

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:620px;margin:0 auto;background:#0f172a;color:#e2e8f0;padding:32px;border-radius:20px">
      <p style="color:#94a3b8;text-transform:uppercase;letter-spacing:.08em;font-size:12px;margin:0 0 12px">DealFlowIQ community invite</p>
      <h1 style="font-size:28px;line-height:1.2;margin:0 0 16px;color:white">Join ${escapeHtml(input.organizationName)}</h1>
      <p style="font-size:16px;line-height:1.6;color:#cbd5e1">You have been invited to join this DealFlowIQ community. Create your account with the code below and you will be added to the right community automatically.</p>
      ${teamLine}
      ${inviterLine}
      <div style="margin:24px 0;padding:18px;border:1px solid rgba(255,255,255,.12);border-radius:16px;background:rgba(255,255,255,.04)">
        <p style="margin:0 0 6px;color:#94a3b8;font-size:13px">Invite code</p>
        <p style="margin:0;font-size:30px;letter-spacing:.16em;font-weight:800;color:white">${escapeHtml(input.inviteCode)}</p>
      </div>
      <a href="${input.inviteUrl}" style="display:inline-block;background:white;color:#0f172a;padding:14px 18px;border-radius:12px;font-weight:700;text-decoration:none">Accept invite</a>
      <p style="margin-top:22px;font-size:13px;line-height:1.6;color:#94a3b8">If the button does not work, open this link: ${escapeHtml(input.inviteUrl)}</p>
    </div>
  `

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: input.to, subject, html }),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return { sent: false, error: text || `Email provider returned ${response.status}` }
    }

    return { sent: true }
  } catch (error) {
    return { sent: false, error: error instanceof Error ? error.message : 'Email send failed' }
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => {
    switch (char) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case "'": return '&#39;'
      case '"': return '&quot;'
      default: return char
    }
  })
}
