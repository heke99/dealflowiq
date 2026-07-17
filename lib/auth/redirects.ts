/** Allows only same-origin relative paths and preserves their query string. */
export function safeRedirectPath(value: unknown, fallback = '/dashboard'): string {
  const path = typeof value === 'string' ? value.trim() : ''
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.includes('\\') || /[\r\n]/.test(path)) return fallback
  try {
    const parsed = new URL(path, 'https://dealflowiq.invalid')
    if (parsed.origin !== 'https://dealflowiq.invalid') return fallback
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return fallback
  }
}

export function authPath(path: '/login' | '/signup', next?: unknown, params: Record<string, string | null | undefined> = {}) {
  const search = new URLSearchParams()
  if (next) search.set('next', safeRedirectPath(next))
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value)
  const query = search.toString()
  return query ? `${path}?${query}` : path
}
