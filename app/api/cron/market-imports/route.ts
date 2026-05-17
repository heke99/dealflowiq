import { NextResponse, type NextRequest } from 'next/server'
import { runScheduledMarketImports } from '@/lib/market/importRunner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const preferredRegion = 'iad1'
export const maxDuration = 60

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization') || ''
  const userAgent = request.headers.get('user-agent') || ''
  const vercelCronHeader = request.headers.get('x-vercel-cron')

  if (secret) return authHeader === `Bearer ${secret}` || authHeader === secret
  return userAgent.includes('vercel-cron') || vercelCronHeader === '1'
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized cron request' }, { status: 401 })
  }

  try {
    const result = await runScheduledMarketImports({ limitSources: 10 })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Scheduled market import failed'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
