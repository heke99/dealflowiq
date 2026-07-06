/** Pure helpers for displaying deal_files metadata. */

/** Human-readable file size, or null when the size was never stored. */
export function formatFileSize(bytes: unknown): string | null {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value <= 0) return null
  if (value < 1024) return `${Math.round(value)} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}
