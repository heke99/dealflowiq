import { describe, expect, it } from 'vitest'
import { safeRedirectPath } from '@/lib/auth/redirects'

describe('safeRedirectPath', () => {
  it('allows same-origin absolute paths', () => {
    expect(safeRedirectPath('/dashboard')).toBe('/dashboard')
    expect(safeRedirectPath('/deals/123?tab=files')).toBe('/deals/123?tab=files')
  })

  it('rejects external and protocol-relative URLs', () => {
    expect(safeRedirectPath('https://evil.example')).toBe('/dashboard')
    expect(safeRedirectPath('//evil.example/phish')).toBe('/dashboard')
    expect(safeRedirectPath('javascript:alert(1)')).toBe('/dashboard')
  })

  it('rejects malformed values and falls back', () => {
    expect(safeRedirectPath('')).toBe('/dashboard')
    expect(safeRedirectPath(null)).toBe('/dashboard')
    expect(safeRedirectPath(undefined)).toBe('/dashboard')
    expect(safeRedirectPath(42)).toBe('/dashboard')
    expect(safeRedirectPath('/path\\evil')).toBe('/dashboard')
    expect(safeRedirectPath('/line\nbreak')).toBe('/dashboard')
  })

  it('supports a custom fallback', () => {
    expect(safeRedirectPath(null, '/reset-password')).toBe('/reset-password')
  })
})
