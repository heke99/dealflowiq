import { describe, expect, it } from 'vitest'
import { decideWebhookRetry, STALE_PROCESSING_MS } from '@/lib/billing/webhookIdempotency'

const NOW = new Date('2026-07-01T12:00:00Z').getTime()

describe('decideWebhookRetry', () => {
  it('skips events that were already processed', () => {
    expect(decideWebhookRetry({ existingStatus: 'processed', updatedAt: null, now: NOW })).toBe('skip_duplicate')
  })

  it('skips events another worker is actively processing', () => {
    const recent = new Date(NOW - 60 * 1000).toISOString()
    expect(decideWebhookRetry({ existingStatus: 'processing', updatedAt: recent, now: NOW })).toBe('skip_in_progress')
  })

  it('takes over stale processing rows (crashed worker)', () => {
    const stale = new Date(NOW - STALE_PROCESSING_MS - 1000).toISOString()
    expect(decideWebhookRetry({ existingStatus: 'processing', updatedAt: stale, now: NOW })).toBe('reprocess')
  })

  it('takes over processing rows without a timestamp', () => {
    expect(decideWebhookRetry({ existingStatus: 'processing', updatedAt: null, now: NOW })).toBe('reprocess')
  })

  it('reprocesses failed events', () => {
    expect(decideWebhookRetry({ existingStatus: 'failed', updatedAt: null, now: NOW })).toBe('reprocess')
  })

  it('reprocesses unknown statuses defensively', () => {
    expect(decideWebhookRetry({ existingStatus: undefined, updatedAt: null, now: NOW })).toBe('reprocess')
  })
})
