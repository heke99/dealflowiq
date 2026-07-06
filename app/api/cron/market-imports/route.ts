import { NextResponse, type NextRequest } from 'next/server'
import { recoverStuckImports, runScheduledMarketImports } from '@/lib/market/importRunner'
import { runDataRetentionSweep } from '@/lib/retention'
import { logError, logInfo } from '@/lib/observability/log'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { asRow, asRows } from '@/lib/types/rows'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const preferredRegion = 'iad1'
export const maxDuration = 60

const STALE_PREVIEW_ITEM_DAYS = 14

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization') || ''
  const userAgent = request.headers.get('user-agent') || ''
  const vercelCronHeader = request.headers.get('x-vercel-cron')

  if (secret) return authHeader === `Bearer ${secret}` || authHeader === secret
  // The user-agent fallback is only acceptable outside production; production
  // requests are rejected earlier when CRON_SECRET is unset.
  return userAgent.includes('vercel-cron') || vercelCronHeader === '1'
}

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production' && !process.env.CRON_SECRET) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET is not configured. Scheduled imports are disabled in production until the secret is set.' },
      { status: 503 }
    )
  }

  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized cron request' }, { status: 401 })
  }

  try {
    const supabase = createSupabaseAdminClient()

    const recovered = await recoverStuckImports(supabase)

    const stalePreviewCutoff = new Date(Date.now() - STALE_PREVIEW_ITEM_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const { data: deletedPreviewRows } = await supabase
      .from('market_import_preview_items')
      .delete()
      .lt('created_at', stalePreviewCutoff)
      .in('status', ['new', 'failed', 'duplicate', 'existing', 'ignored'])
      .select('id')
    const stalePreviewItemsDeleted = asRows(deletedPreviewRows).length

    const { data: cleanupData } = await supabase.rpc('cleanup_expired_market_source_data')
    const expiredProviderDataCleaned = Array.isArray(cleanupData)
      ? Number(asRow(cleanupData[0])?.cleaned_count || 0)
      : Number(cleanupData || 0)

    const retention = await runDataRetentionSweep(supabase)

    const sweep = {
      requeuedItems: recovered.requeuedItems,
      failedJobs: recovered.failedJobs,
      stalePreviewItemsDeleted,
      expiredProviderDataCleaned,
      retention,
    }

    const result = await runScheduledMarketImports({ limitSources: 10 })

    logInfo('cron.market_imports.completed', {
      ranAt: result.ranAt,
      sourceCount: result.sourceCount,
      totals: result.totals,
      sweep,
    })

    return NextResponse.json({ ok: true, ...result, sweep })
  } catch (error) {
    logError('cron.market_imports.failed', error)
    const message = error instanceof Error ? error.message : 'Scheduled market import failed'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
