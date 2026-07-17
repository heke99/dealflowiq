/**
 * Single source of truth for post-auth redirect safety.
 *
 * Only same-origin absolute paths are allowed; anything else (external URLs,
 * protocol-relative `//evil.com`, empty values) falls back. Used by login,
 * signup, the auth callback and the confirm route.
 */
export function safeRedirectPath(value: unknown, fallback = '/dashboard'): string {
  const path = typeof value === 'string' ? value : ''
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.includes('\n')) {
    return fallback
  }
  return path
}
