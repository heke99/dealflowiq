/**
 * Pure deal lifecycle helpers shared by server actions and tests.
 *
 * Keep this module free of Supabase/Next.js imports so the mapping and
 * validation logic stays unit-testable.
 */
import type { Row } from '@/lib/types/rows'

/** Whitelist mirroring the deals.status CHECK constraint (migration 004). */
export const DEAL_STATUSES = [
  'draft',
  'imported',
  'needs_review',
  'analyzed',
  'approved',
  'rejected',
  'under_contract',
  'sent_to_buyers',
  'offers_received',
  'assigned',
  'closed',
  'dead',
] as const

export type DealStatus = (typeof DEAL_STATUSES)[number]

export function isDealStatus(value: unknown): value is DealStatus {
  return typeof value === 'string' && (DEAL_STATUSES as readonly string[]).includes(value)
}

export function normalizeDealStatus(value: unknown, fallback: DealStatus = 'draft'): DealStatus {
  return isDealStatus(value) ? value : fallback
}

/** Terminal status used by archive: keeps the deal and its history around. */
export const ARCHIVED_DEAL_STATUS: DealStatus = 'dead'

/** Columns that must never be copied onto a duplicated deal row. */
const DUPLICATE_DEAL_EXCLUDED_FIELDS = new Set(['id', 'created_at', 'updated_at', 'published_at', 'expires_at', 'properties'])

/**
 * Builds the insert payload for a duplicated deal: every column of the source
 * row except identity/timestamps/publish state, retitled as a private draft
 * owned by the duplicating user.
 */
export function duplicateDealPayload(deal: Row, params: { organizationId: string; userId: string }): Record<string, unknown> {
  const copy: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(deal)) {
    if (DUPLICATE_DEAL_EXCLUDED_FIELDS.has(key)) continue
    copy[key] = value
  }
  return {
    ...copy,
    organization_id: params.organizationId,
    created_by: params.userId,
    assigned_user_id: params.userId,
    title: `${String(deal.title || 'Untitled Deal')} (copy)`,
    status: 'draft',
    visibility: 'private',
  }
}

const DUPLICATE_PROPERTY_EXCLUDED_FIELDS = new Set(['id', 'created_at', 'updated_at', 'deal_id'])

/** Builds the insert payload for the duplicated deal's properties row. */
export function duplicatePropertyPayload(property: Row, params: { organizationId: string; dealId: string }): Record<string, unknown> {
  const copy: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(property)) {
    if (DUPLICATE_PROPERTY_EXCLUDED_FIELDS.has(key)) continue
    copy[key] = value
  }
  return {
    ...copy,
    organization_id: params.organizationId,
    deal_id: params.dealId,
  }
}
