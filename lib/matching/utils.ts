/**
 * Shared pure primitives used by the matching engines.
 *
 * The two engines (buy-box criteria matching in lib/market and buyer-listing
 * matching in lib/matching) intentionally stay separate; only these low-level
 * normalization helpers are shared between them.
 */

/** Normalize an unknown list value into trimmed, lowercased, non-empty strings. */
export function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item).trim().toLowerCase()).filter(Boolean)
}

/** Coerce an unknown money-like value into a finite number (missing/invalid becomes 0). */
export function moneyNumber(value: unknown): number {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Normalize a cap-rate-like value into a decimal rate. Values above 1 are treated as percentages (7 -> 0.07). */
export function capRateNumber(value: unknown): number {
  const parsed = Number(value || 0)
  if (!Number.isFinite(parsed)) return 0
  return parsed > 1 ? parsed / 100 : parsed
}

/** True when value sits inside the optional inclusive [min, max] bounds. Missing/non-finite bounds are ignored. */
export function withinRange(value: number, min?: number | null, max?: number | null): boolean {
  if (typeof min === 'number' && Number.isFinite(min) && value < min) return false
  if (typeof max === 'number' && Number.isFinite(max) && value > max) return false
  return true
}

/** Clamp raw match points into a rounded 0-100 score. */
export function clampScore(points: number): number {
  return Math.max(0, Math.min(100, Math.round(points)))
}
