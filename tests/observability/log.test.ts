import { describe, expect, it } from 'vitest'
import { userSafeError } from '@/lib/observability/log'

describe('userSafeError', () => {
  it('passes through benign user-facing messages', () => {
    expect(userSafeError(new Error('Plan not found.'))).toBe('Plan not found.')
  })

  it('hides internal details (secrets, SQL, connections)', () => {
    const fallback = 'Something went wrong. Try again or contact support.'
    expect(userSafeError(new Error('permission denied for table billing_plans'))).toBe(fallback)
    expect(userSafeError(new Error('connect ECONNREFUSED 127.0.0.1:5432'))).toBe(fallback)
    expect(userSafeError(new Error('invalid api key provided'))).toBe(fallback)
    expect(userSafeError(new Error('syntax error at or near SELECT'))).toBe(fallback)
  })

  it('handles non-Error values', () => {
    expect(userSafeError('boom')).toBe('Something went wrong. Try again or contact support.')
    expect(userSafeError(undefined, 'Custom fallback')).toBe('Custom fallback')
  })
})
