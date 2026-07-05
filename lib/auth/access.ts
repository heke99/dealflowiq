/**
 * Central RBAC / authorization layer.
 *
 * Every server action and protected page should authorize through this module
 * instead of re-implementing role logic. The layers are:
 *
 * 1. Platform admin  — `platform_admins` table, full access everywhere.
 * 2. Organization role — `organization_members.role` (org_member_role enum).
 * 3. Feature access  — plan/trial/override feature flags (`WorkspaceAccess`).
 * 4. Limits          — numeric plan limits (`null` means unlimited).
 */
import { redirect } from 'next/navigation'
import { requireUser, getCurrentUser } from '@/lib/auth/session'
import { getCurrentWorkspace, type CurrentWorkspace } from '@/lib/auth/workspace'
import { isCurrentUserPlatformAdmin, requirePlatformAdmin } from '@/lib/auth/admin'
import { canUseFeature, type FeatureKey } from '@/lib/billing/features'

export { getCurrentWorkspace, isCurrentUserPlatformAdmin, requirePlatformAdmin, canUseFeature }
export type { CurrentWorkspace }

export type OrgRole =
  | 'owner'
  | 'admin'
  | 'acquisition_manager'
  | 'disposition_manager'
  | 'member'
  | 'buyer'
  | 'viewer'

/** Roles allowed to manage billing, members, workspace settings. */
export const MANAGEMENT_ROLES: OrgRole[] = ['owner', 'admin']
/** Roles allowed to create/edit org content (everything except viewer). */
export const WRITER_ROLES: OrgRole[] = ['owner', 'admin', 'acquisition_manager', 'disposition_manager', 'member', 'buyer']

export async function getCurrentUserOrRedirect() {
  return requireUser()
}

export { getCurrentUser }

export function currentRole(workspace: CurrentWorkspace): OrgRole | null {
  const role = workspace.membership?.role
  return role ? (role as OrgRole) : null
}

export function hasOrganizationRole(workspace: CurrentWorkspace, roles: OrgRole[]): boolean {
  if (workspace.access.isPlatformAdmin) return true
  const role = currentRole(workspace)
  return Boolean(role && roles.includes(role))
}

/**
 * Redirects with an error message when the current member does not hold one
 * of the required roles. Platform admins always pass.
 */
export function requireOrganizationRole(
  workspace: CurrentWorkspace,
  roles: OrgRole[],
  redirectTo = '/dashboard'
): void {
  if (hasOrganizationRole(workspace, roles)) return
  redirect(`${redirectTo}?error=${encodeURIComponent('You do not have permission to perform this action.')}`)
}

export function canManageBilling(workspace: CurrentWorkspace): boolean {
  return hasOrganizationRole(workspace, MANAGEMENT_ROLES)
}

export function canManageMembers(workspace: CurrentWorkspace): boolean {
  return hasOrganizationRole(workspace, MANAGEMENT_ROLES)
}

export function canManageDeals(workspace: CurrentWorkspace): boolean {
  return hasOrganizationRole(workspace, WRITER_ROLES)
}

export function canManageImports(workspace: CurrentWorkspace): boolean {
  return hasOrganizationRole(workspace, WRITER_ROLES)
}

export function canManageListings(workspace: CurrentWorkspace): boolean {
  return hasOrganizationRole(workspace, WRITER_ROLES)
}

/**
 * Redirects when the workspace does not have the feature enabled.
 * Platform admins always pass (they receive ALL_FEATURES).
 */
export function assertFeatureAccess(
  workspace: CurrentWorkspace,
  feature: FeatureKey,
  redirectTo = '/settings/billing'
): void {
  if (workspace.access.isPlatformAdmin) return
  if (canUseFeature(workspace.access.features, feature)) return
  redirect(`${redirectTo}?error=${encodeURIComponent('This feature requires a higher plan. Upgrade to continue.')}`)
}

export type LimitCheck = {
  allowed: boolean
  limit: number | null
  used: number
  remaining: number | null
}

/** Pure limit evaluation: `null` limit means unlimited. */
export function evaluateLimit(limit: number | null | undefined, used: number): LimitCheck {
  if (limit === null || limit === undefined) {
    return { allowed: true, limit: null, used, remaining: null }
  }
  const remaining = Math.max(0, limit - used)
  return { allowed: used < limit, limit, used, remaining }
}

/**
 * Redirects when a numeric plan limit is exhausted. Platform admins always
 * pass. `used` is the current consumption the caller measured.
 */
export function assertLimitAvailable(
  workspace: CurrentWorkspace,
  limitKey: string,
  used: number,
  redirectTo = '/settings/billing'
): LimitCheck {
  if (workspace.access.isPlatformAdmin) {
    return { allowed: true, limit: null, used, remaining: null }
  }
  const check = evaluateLimit(workspace.access.limits[limitKey], used)
  if (!check.allowed) {
    redirect(`${redirectTo}?error=${encodeURIComponent(`You reached your plan limit (${check.limit}). Upgrade to continue.`)}`)
  }
  return check
}
