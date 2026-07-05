import { redirect } from 'next/navigation'
import { isCurrentUserPlatformAdmin } from '@/lib/auth/admin'

/**
 * Server-side gate for every /admin route. Middleware only verifies that a
 * session exists; this layout enforces platform-admin membership before any
 * admin page renders. Individual server actions still call
 * requirePlatformAdmin() so direct action invocation is also protected.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const isAdmin = await isCurrentUserPlatformAdmin()
  if (!isAdmin) {
    redirect(`/dashboard?error=${encodeURIComponent('Platform admin access is required for that page.')}`)
  }
  return <>{children}</>
}
