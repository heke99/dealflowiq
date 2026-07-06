import { describe, expect, it } from 'vitest'
import {
  ALL_FEATURES,
  FEATURE_KEYS,
  FREE_LIMITS,
  TRIAL_LIMITS,
  canUseFeature,
  isCoreFeature,
  mergeFeatures,
  mergeLimits,
} from '@/lib/billing/features'

describe('mergeLimits', () => {
  it('merges maps left to right with later maps winning', () => {
    expect(mergeLimits({ a: 1 }, { a: 2 })).toEqual({ a: 2 })
    expect(mergeLimits({ a: 1 }, { b: 3 })).toEqual({ a: 1, b: 3 })
  })

  it('ignores undefined values from partial overrides', () => {
    expect(mergeLimits({ a: 5 }, { a: undefined })).toEqual({ a: 5 })
    expect(mergeLimits({ a: 5 }, { b: undefined })).toEqual({ a: 5 })
  })

  it('preserves null as unlimited', () => {
    expect(mergeLimits({ a: 5 }, { a: null })).toEqual({ a: null })
    expect(mergeLimits({ a: null }, { a: 3 })).toEqual({ a: 3 })
  })

  it('skips null/undefined maps entirely', () => {
    expect(mergeLimits(null, undefined, { a: 1 })).toEqual({ a: 1 })
    expect(mergeLimits()).toEqual({})
  })

  it('drops non-finite numbers', () => {
    expect(mergeLimits({ a: Number.NaN, b: Number.POSITIVE_INFINITY, c: 2 })).toEqual({ c: 2 })
  })

  it('never returns undefined values (LimitMap contract)', () => {
    const merged = mergeLimits(FREE_LIMITS, { max_saved_deals: undefined }, TRIAL_LIMITS)
    for (const value of Object.values(merged)) {
      expect(value === null || Number.isFinite(value)).toBe(true)
    }
  })
})

describe('mergeFeatures', () => {
  it('merges with later maps winning', () => {
    expect(mergeFeatures({ deals: true }, { deals: false })).toEqual({ deals: false })
  })

  it('handles null and undefined maps', () => {
    expect(mergeFeatures(null, { flip: true }, undefined)).toEqual({ flip: true })
  })
})

describe('canUseFeature', () => {
  it('returns true only for explicitly enabled features', () => {
    expect(canUseFeature({ deals: true }, 'deals')).toBe(true)
    expect(canUseFeature({ deals: false }, 'deals')).toBe(false)
    expect(canUseFeature({}, 'deals')).toBe(false)
    expect(canUseFeature(null, 'deals')).toBe(false)
  })
})

describe('feature catalog', () => {
  it('ALL_FEATURES enables every known feature key', () => {
    for (const key of FEATURE_KEYS) {
      expect(ALL_FEATURES[key]).toBe(true)
    }
  })

  it('core features are a subset of all features', () => {
    expect(isCoreFeature('deals')).toBe(true)
    expect(isCoreFeature('white_label')).toBe(false)
  })
})
