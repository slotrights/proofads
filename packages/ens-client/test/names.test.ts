import { describe, expect, it } from 'vitest'
import { labelhash, namehash, slotId } from '../src/names'

describe('labelhash', () => {
	it('matches the values ENSv2 emits on chain', () => {
		// Both observed in `LabelStore.Label` events from our local ENSv2 deployment.
		expect(labelhash('eth')).toBe('0x4f5b812789fc606be1b3b16908db13fc7a9adf7ca72641f84d75b47069d3d7f0')
		expect(labelhash('hero')).toBe('0xf5ae61672361c474f5ea3e994da5ef9670fc4455792bd5cc81189dd6b2dc9da2')
	})
})

describe('namehash', () => {
	it('returns the zero node for the root', () => {
		expect(namehash('')).toBe(`0x${'00'.repeat(32)}`)
	})

	it('matches the canonical ENSIP-1 vectors', () => {
		expect(namehash('eth')).toBe('0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae')
		expect(namehash('foo.eth')).toBe('0xde9b09fd7c5f901e23a3f19fecc54828e9c848539801e86591bd9801b019f84f')
	})

	it('is hierarchical, so a slot name is derived from its parents', () => {
		const ads = namehash('ads.proofads-pub.eth')
		const hero = namehash('hero.ads.proofads-pub.eth')
		expect(hero).not.toBe(ads)
		expect(hero).toMatch(/^0x[0-9a-f]{64}$/)
	})
})

describe('slotId', () => {
	const registry = '0x712516e61C8B383dF4A63CFe83d7701Bce54B03e'

	it('is scoped to the registry, so the same label in two inventories differs', () => {
		const other = '0x0000000000000000000000000000000000000001'
		expect(slotId(registry, 'hero')).not.toBe(slotId(other, 'hero'))
	})

	it('is case-insensitive in the registry address', () => {
		expect(slotId(registry.toLowerCase() as `0x${string}`, 'hero')).toBe(slotId(registry, 'hero'))
	})

	it('distinguishes slots within one inventory', () => {
		expect(slotId(registry, 'hero')).not.toBe(slotId(registry, 'sidebar'))
	})
})
