/**
 * Shared helpers for working with loosely-typed Supabase rows.
 *
 * Most queries in this app select wide rows (`select('*')`) whose full shape
 * is defined by SQL migrations rather than generated TypeScript types. `Row`
 * is the safe replacement for `Record<string, any>`: property access is
 * allowed but every value must be narrowed before use. The accessors below
 * centralize that narrowing.
 */
export type Row = Record<string, unknown>

/** Coerce an unknown value to a trimmed string, or null when absent/blank. */
export function rowString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

/** Coerce an unknown value to a finite number, or null. */
export function rowNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** Coerce an unknown value to a boolean (null/undefined -> false). */
export function rowBoolean(value: unknown): boolean {
  return Boolean(value)
}

/** Narrow an unknown value to a Row when it is a plain object. */
export function asRow(value: unknown): Row | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Row
}

/** Narrow an unknown value to an array of Rows (non-arrays become []). */
export function asRows(value: unknown): Row[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Row => Boolean(item) && typeof item === 'object')
}

/**
 * Supabase embeds (`select('*, related(*)')`) can come back as an object or
 * a single-element array depending on the relationship. Normalize to one Row.
 */
export function firstRow(value: unknown): Row | null {
  if (Array.isArray(value)) return asRow(value[0])
  return asRow(value)
}
