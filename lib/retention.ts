import type { createSupabaseAdminClient } from '@/lib/supabase/admin'

type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>

export const RETENTION_DAYS = {
  stripeWebhookEvents: 90,
  importAuditEvents: 90,
  notifications: 90,
  failedImportJobs: 30,
} as const

function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

export type RetentionSweepResult = {
  webhookEventsDeleted: number
  importAuditEventsDeleted: number
  notificationsDeleted: number
  failedJobsDeleted: number
}

/**
 * Periodic data-retention sweep, run from the cron worker.
 *
 * - Processed Stripe webhook events are audit data with a 90-day window
 *   (failed events are kept so operators can retry them from Stripe).
 * - Import audit events feed rolling rate limits (hour/month windows), so
 *   anything older than 90 days is safe to prune.
 * - Notifications that are read or archived age out after 90 days.
 * - Terminally failed import jobs older than 30 days are noise.
 */
export async function runDataRetentionSweep(supabase: SupabaseAdmin): Promise<RetentionSweepResult> {
  const [webhookEvents, auditEvents, notifications, failedJobs] = await Promise.all([
    supabase
      .from('stripe_webhook_events')
      .delete({ count: 'exact' })
      .eq('status', 'processed')
      .lt('created_at', daysAgoIso(RETENTION_DAYS.stripeWebhookEvents)),
    supabase
      .from('market_import_audit_events')
      .delete({ count: 'exact' })
      .lt('created_at', daysAgoIso(RETENTION_DAYS.importAuditEvents)),
    supabase
      .from('notifications')
      .delete({ count: 'exact' })
      .lt('created_at', daysAgoIso(RETENTION_DAYS.notifications))
      .not('read_at', 'is', null),
    supabase
      .from('market_import_jobs')
      .delete({ count: 'exact' })
      .eq('status', 'failed')
      .lt('created_at', daysAgoIso(RETENTION_DAYS.failedImportJobs)),
  ])

  return {
    webhookEventsDeleted: webhookEvents.count || 0,
    importAuditEventsDeleted: auditEvents.count || 0,
    notificationsDeleted: notifications.count || 0,
    failedJobsDeleted: failedJobs.count || 0,
  }
}
