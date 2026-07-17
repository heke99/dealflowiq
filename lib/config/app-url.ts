const LOCAL_URL = 'http://localhost:3000'

function normalizeBaseUrl(value: string) {
  const url = new URL(value.includes('://') ? value : `https://${value}`)
  url.pathname = ''
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

/** Canonical base URL used by every auth, invite and billing link. */
export function getCanonicalAppUrl() {
  const configured = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL
  if (configured) return normalizeBaseUrl(configured)
  if (process.env.VERCEL_ENV === 'production' && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return normalizeBaseUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL)
  }
  if (process.env.VERCEL_URL) return normalizeBaseUrl(process.env.VERCEL_URL)
  return LOCAL_URL
}

export function absoluteAppUrl(path = '/') {
  const safePath = path.startsWith('/') ? path : `/${path}`
  return new URL(safePath, `${getCanonicalAppUrl()}/`).toString()
}
