export async function sendPasswordChangedEmail(to: string): Promise<{ sent: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.SECURITY_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || 'DealFlowIQ <noreply@dealflowiq.com>'
  if (!apiKey) return { sent: false, error: 'Email provider is not configured' }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to,
        subject: 'Your DealFlowIQ password was changed',
        html: '<div style="font-family:Inter,Arial,sans-serif;max-width:620px;margin:auto"><h1>Password changed</h1><p>Your DealFlowIQ password was changed successfully.</p><p>If you did not make this change, contact support immediately and reset your password.</p></div>',
      }),
    })
    if (!response.ok) return { sent: false, error: `Email provider returned ${response.status}` }
    return { sent: true }
  } catch (error) {
    return { sent: false, error: error instanceof Error ? error.message : 'Email delivery failed' }
  }
}


export async function sendAccountDeletedEmail(to: string): Promise<{ sent: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.SECURITY_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || 'DealFlowIQ <noreply@dealflowiq.com>'
  if (!apiKey) return { sent: false, error: 'Email provider is not configured' }
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to,
        subject: 'Your DealFlowIQ account was deleted',
        html: '<div style="font-family:Inter,Arial,sans-serif;max-width:620px;margin:auto"><h1>Account deleted</h1><p>Your DealFlowIQ login and personal profile were deleted.</p><p>Workspaces with transferred ownership and their business records remain intact.</p></div>',
      }),
    })
    if (!response.ok) return { sent: false, error: `Email provider returned ${response.status}` }
    return { sent: true }
  } catch (error) {
    return { sent: false, error: error instanceof Error ? error.message : 'Email delivery failed' }
  }
}
