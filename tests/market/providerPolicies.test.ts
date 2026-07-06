import { describe, expect, it } from 'vitest'
import { DEFAULT_PROVIDER_POLICIES, providerPolicyFromRow, providerPolicySnapshot } from '@/lib/market/providerPolicies'

describe('providerPolicyFromRow', () => {
  it('returns the default policy when no DB row exists', () => {
    const policy = providerPolicyFromRow('zillow', null)
    expect(policy).toEqual(DEFAULT_PROVIDER_POLICIES.zillow)
  })

  it('falls back to the generic (inactive) policy for unknown providers', () => {
    const policy = providerPolicyFromRow('unknown_provider', null)
    expect(policy.active).toBe(false)
    expect(policy.listingImportAllowed).toBe(false)
    expect(policy.searchImportAllowed).toBe(false)
  })

  it('lets a DB row disable a provider (admin policy block)', () => {
    const policy = providerPolicyFromRow('zillow', { is_active: false })
    expect(policy.active).toBe(false)
  })

  it('lets a DB row tighten rate limits and permissions', () => {
    const policy = providerPolicyFromRow('zillow', {
      is_active: true,
      max_listings_per_hour: 2,
      search_import_allowed: false,
      images_allowed: false,
      storage_days: 7,
    })
    expect(policy.maxListingsPerHour).toBe(2)
    expect(policy.searchImportAllowed).toBe(false)
    expect(policy.imagesAllowed).toBe(false)
    expect(policy.storageDays).toBe(7)
    expect(policy.listingImportAllowed).toBe(true)
  })

  it('keeps defaults for fields the row does not set', () => {
    const policy = providerPolicyFromRow('investorlift', { max_listings_per_hour: 10 })
    expect(policy.maxListingsPerHour).toBe(10)
    expect(policy.attributionRequired).toBe(DEFAULT_PROVIDER_POLICIES.investorlift.attributionRequired)
  })
})

describe('policy safety defaults', () => {
  it('every default policy requires source links and attribution', () => {
    for (const policy of Object.values(DEFAULT_PROVIDER_POLICIES)) {
      expect(policy.sourceLinkRequired).toBe(true)
      expect(policy.attributionRequired).toBe(true)
    }
  })

  it('every active default policy documents the no-bypass rule', () => {
    for (const policy of Object.values(DEFAULT_PROVIDER_POLICIES)) {
      if (!policy.active) continue
      expect(policy.notes.toLowerCase()).toContain('no proxy rotation')
    }
  })

  it('generic fallback provider is inactive by default', () => {
    expect(DEFAULT_PROVIDER_POLICIES.generic.active).toBe(false)
    expect(DEFAULT_PROVIDER_POLICIES.generic.maxListingsPerHour).toBe(0)
  })
})

describe('providerPolicySnapshot', () => {
  it('captures the enforcement-relevant fields', () => {
    const snapshot = providerPolicySnapshot(DEFAULT_PROVIDER_POLICIES.zillow)
    expect(snapshot).toMatchObject({
      sourceType: 'zillow',
      maxListingsPerHour: DEFAULT_PROVIDER_POLICIES.zillow.maxListingsPerHour,
      storageDays: DEFAULT_PROVIDER_POLICIES.zillow.storageDays,
      searchImportAllowed: true,
      listingImportAllowed: true,
    })
  })
})
