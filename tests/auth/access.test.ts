import { describe, expect, it } from 'vitest'
import { evaluateLimit } from '@/lib/auth/access'

describe('evaluateLimit', () => {
  it('treats null/undefined limits as unlimited', () => {
    expect(evaluateLimit(null, 100)).toEqual({ allowed: true, limit: null, used: 100, remaining: null })
    expect(evaluateLimit(undefined, 100)).toEqual({ allowed: true, limit: null, used: 100, remaining: null })
  })

  it('allows usage below the limit', () => {
    expect(evaluateLimit(5, 4)).toEqual({ allowed: true, limit: 5, used: 4, remaining: 1 })
  })

  it('blocks usage at or above the limit', () => {
    expect(evaluateLimit(5, 5).allowed).toBe(false)
    expect(evaluateLimit(5, 9).allowed).toBe(false)
    expect(evaluateLimit(5, 9).remaining).toBe(0)
  })

  it('blocks everything when the limit is zero', () => {
    expect(evaluateLimit(0, 0).allowed).toBe(false)
  })
})
