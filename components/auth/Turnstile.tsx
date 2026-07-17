'use client'

import Script from 'next/script'
import { useId } from 'react'

declare global {
  interface Window {
    turnstile?: { render: (element: string | HTMLElement, options: Record<string, unknown>) => string }
  }
}

export function Turnstile({ action }: { action: string }) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  const reactId = useId().replace(/:/g, '')
  if (!siteKey) return null
  const elementId = `turnstile-${reactId}`

  return (
    <>
      <div id={elementId} className="min-h-[65px]" />
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => {
          window.turnstile?.render(`#${elementId}`, {
            sitekey: siteKey,
            action,
            theme: 'dark',
            'response-field-name': 'captcha_token',
          })
        }}
      />
    </>
  )
}
