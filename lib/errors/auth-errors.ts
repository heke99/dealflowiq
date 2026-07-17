export const AUTH_ERROR_CODES = {
  AUTH_REQUIRED: 'You need to log in to continue.',
  INVALID_CREDENTIALS: 'The email or password is incorrect.',
  EMAIL_NOT_CONFIRMED: 'Confirm your email before logging in.',
  INVALID_AUTH_CALLBACK: 'The sign-in link is invalid or has expired.',
  AUTH_SERVICE_UNAVAILABLE: 'Authentication is temporarily unavailable. Try again.',
  SIGNUP_INVALID: 'Check the form and try again.',
  SIGNUP_FAILED: 'The account could not be created. Try again.',
  PASSWORD_RESET_SENT: 'If an account exists, password reset instructions have been sent.',
  PASSWORD_RESET_INVALID: 'The password reset link is invalid or has expired.',
  PASSWORD_UPDATE_FAILED: 'The password could not be changed. Request a new reset link.',
  INVITE_INVALID: 'The invite is invalid.',
  INVITE_EXPIRED: 'The invite has expired.',
  INVITE_REVOKED: 'The invite has been revoked.',
  INVITE_ALREADY_USED: 'The invite has already been fully used.',
  INVITE_EMAIL_MISMATCH: 'This invite belongs to a different email address.',
  INVITE_ACCEPTANCE_FAILED: 'The invite could not be accepted. Nothing was changed.',
  WORKSPACE_BOOTSTRAP_FAILED: 'Your workspace could not be prepared. Try again.',
  WORKSPACE_ACCESS_DENIED: 'You no longer have access to that workspace.',
  PROFILE_UNAVAILABLE: 'Your account profile could not be loaded. Retry the setup repair.',
  ONBOARDING_FAILED: 'Your setup could not be saved. Nothing was changed.',
  RATE_LIMITED: 'Too many attempts. Wait a moment and try again.',
  CONFIRM_EMAIL: 'Account created. Check your email to confirm it, then log in.',
  CONFIRMATION_SENT: 'If the account exists, a confirmation email has been sent.',
  PASSWORD_UPDATED: 'Password updated. Log in with your new password.',
  PASSWORD_UPDATED_AUDIT_PENDING: 'Password updated. Security confirmation is temporarily delayed; log in with the new password.',
  LEGAL_ACCEPTANCE_REQUIRED: 'Use the verified signup flow and accept the current legal terms before continuing.',
  INTERNAL_ERROR: 'Something went wrong. Try again or contact support.',
} as const

export type AuthErrorCode = keyof typeof AUTH_ERROR_CODES

export function authErrorMessage(value: unknown) {
  const code = String(value || '') as AuthErrorCode
  return AUTH_ERROR_CODES[code] || AUTH_ERROR_CODES.INTERNAL_ERROR
}

export function authErrorCode(error: unknown, fallback: AuthErrorCode = 'INTERNAL_ERROR'): AuthErrorCode {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error || '')
  const upper = message.toUpperCase()
  if (upper.includes('INVALID LOGIN') || upper.includes('INVALID_CREDENTIAL')) return 'INVALID_CREDENTIALS'
  if (upper.includes('EMAIL NOT CONFIRMED')) return 'EMAIL_NOT_CONFIRMED'
  if (upper.includes('INVITE_EXPIRED')) return 'INVITE_EXPIRED'
  if (upper.includes('INVITE_REVOKED')) return 'INVITE_REVOKED'
  if (upper.includes('INVITE_ALREADY_USED')) return 'INVITE_ALREADY_USED'
  if (upper.includes('INVITE_EMAIL_MISMATCH')) return 'INVITE_EMAIL_MISMATCH'
  if (upper.includes('LEGAL_ACCEPTANCE_REQUIRED')) return 'LEGAL_ACCEPTANCE_REQUIRED'
  if (upper.includes('INVITE_INVALID')) return 'INVITE_INVALID'
  if (upper.includes('RATE') || upper.includes('TOO MANY')) return 'RATE_LIMITED'
  return fallback
}
