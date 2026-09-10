import { describe, expect, test } from 'bun:test'
import { keccak256, toHex } from 'viem'
import { batchWindow, canonicalBatchJson, qualify } from './qualify'
import { CAMPAIGN_START, CREATIVE, event, payload } from './fixtures'
import { METRIC_SELFIE_CHECKED_VIEW_10_SECONDS } from './types'

describe('qualify', () => {
	test('counts one unit per valid qualifying event', () => {
		const result = qualify(payload([event(), event()]))
		expect(result.newlyCountedUnits).toBe(2)
		expect(result.cumulativeVerifiedUnits).toBe(2)
	})

	test('counts a session at most once, however many events it sends', () => {
		const result = qualify(payload([event({ sessionId: 's1' }), event({ sessionId: 's1' })]))
		expect(result.newlyCountedUnits).toBe(1)
		expect(result.rejections.SESSION_ALREADY_COUNTED).toBe(1)
	})

	test('rejects events for another campaign', () => {
		const result = qualify(payload([event({ campaignId: 42 })]))
		expect(result.newlyCountedUnits).toBe(0)
		expect(result.rejections.WRONG_CAMPAIGN).toBe(1)
	})

	test('rejects events for another slot on the same page', () => {
		const result = qualify(payload([event({ slotLabel: 'sidebar' })]))
		expect(result.rejections.WRONG_SLOT).toBe(1)
	})

	test('rejects a creative that is not the one the advertiser bought', () => {
		const result = qualify(payload([event({ creativeHash: '0x' + 'cd'.repeat(32) })]))
		expect(result.rejections.WRONG_CREATIVE).toBe(1)
	})

	test('is case-insensitive about the creative hash', () => {
		const result = qualify(payload([event({ creativeHash: CREATIVE.toUpperCase() })]))
		expect(result.newlyCountedUnits).toBe(1)
	})

	test('rejects a view shorter than ten seconds', () => {
		const result = qualify(payload([event({ visibleMs: 9_999 })]))
		expect(result.rejections.SHORT_VIEW).toBe(1)
	})

	test('rejects a view that was never half in the viewport', () => {
		const result = qualify(payload([event({ visibilityRatio: 0.2 })]))
		expect(result.rejections.NOT_VISIBLE_ENOUGH).toBe(1)
	})

	test('rejects progress events, only the qualification event earns a unit', () => {
		const result = qualify(payload([event({ eventType: 'QUALIFYING_TIME_PROGRESS' })]))
		expect(result.rejections.NOT_A_QUALIFYING_EVENT).toBe(1)
	})

	test('rejects events observed before the campaign started', () => {
		const result = qualify(payload([event({ observedAt: CAMPAIGN_START - 10 })]))
		expect(result.rejections.OUTSIDE_CAMPAIGN_WINDOW).toBe(1)
	})

	test('rejects events observed after the campaign deadline', () => {
		const result = qualify(payload([event({ observedAt: CAMPAIGN_START + 99_999 })]))
		expect(result.rejections.OUTSIDE_CAMPAIGN_WINDOW).toBe(1)
	})

	test('ignores the browser-supplied clock entirely', () => {
		// A viewer setting their system clock to 1970, or to next year, changes nothing.
		const past = qualify(payload([event({ clientTime: 0 })]))
		const future = qualify(payload([event({ clientTime: 4_000_000_000_000 })]))
		expect(past.newlyCountedUnits).toBe(1)
		expect(future.newlyCountedUnits).toBe(1)
	})

	test('rejects an event whose session is not in the batch session list', () => {
		const base = payload([event({ sessionId: 'ghost' })])
		base.sessions = []
		expect(qualify(base).rejections.UNKNOWN_SESSION).toBe(1)
	})

	// ── Premium metric (built, not enabled) ─────────────────────────────
	test('premium metric rejects a session with no verified liveness credential', () => {
		const result = qualify(
			payload([event({ sessionId: 's1' })], {
				metric: METRIC_SELFIE_CHECKED_VIEW_10_SECONDS,
				worldEligible: { s1: false },
			}),
		)
		expect(result.newlyCountedUnits).toBe(0)
		expect(result.rejections.WORLD_ELIGIBILITY_MISSING).toBe(1)
	})

	test('premium metric counts a session whose liveness credential was verified', () => {
		const result = qualify(
			payload([event({ sessionId: 's1' })], {
				metric: METRIC_SELFIE_CHECKED_VIEW_10_SECONDS,
				worldEligible: { s1: true },
			}),
		)
		expect(result.newlyCountedUnits).toBe(1)
	})

	test('the standard metric ignores liveness entirely', () => {
		const result = qualify(payload([event({ sessionId: 's1' })], { worldEligible: { s1: false } }))
		expect(result.newlyCountedUnits).toBe(1)
	})

	// ── Cumulative semantics ────────────────────────────────────────────
	test('reports a cumulative total, not a delta', () => {
		const result = qualify(payload([event()], { previouslySettledUnits: 1, targetUnits: 5 }))
		expect(result.newlyCountedUnits).toBe(1)
		expect(result.cumulativeVerifiedUnits).toBe(2)
	})

	test('caps the cumulative total at the campaign target', () => {
		const result = qualify(payload([event(), event(), event()], { targetUnits: 2 }))
		expect(result.newlyCountedUnits).toBe(3)
		expect(result.cumulativeVerifiedUnits).toBe(2)
	})

	test('an empty batch reports whatever was already settled', () => {
		const result = qualify(payload([], { previouslySettledUnits: 1, targetUnits: 2 }))
		expect(result.cumulativeVerifiedUnits).toBe(1)
	})

	test('counts a mixed batch correctly', () => {
		const events = [
			event({ sessionId: 'good-1' }),
			event({ sessionId: 'good-2' }),
			event({ sessionId: 'good-1' }), // duplicate session
			event({ sessionId: 'short', visibleMs: 3_000 }),
			event({ sessionId: 'wrong-slot', slotLabel: 'sidebar' }),
		]
		const result = qualify(payload(events, { targetUnits: 10 }))
		expect(result.newlyCountedUnits).toBe(2)
		expect(result.countedSessions).toEqual(['good-1', 'good-2'])
	})
})

describe('canonicalBatchJson', () => {
	test('matches the digest the collector publishes', () => {
		const events = [event(), event()]
		const built = payload(events)
		expect(keccak256(toHex(canonicalBatchJson(events)))).toBe(built.batch.digest as `0x${string}`)
	})

	test('changes when any counted field is altered', () => {
		const events = [event()]
		const before = canonicalBatchJson(events)
		const after = canonicalBatchJson([{ ...events[0]!, visibleMs: 20_000 }])
		expect(before).not.toBe(after)
	})

	test('ignores fields outside the canonical projection', () => {
		const events = [event()]
		const withDifferentClock = [{ ...events[0]!, clientTime: 1 }]
		expect(canonicalBatchJson(events)).toBe(canonicalBatchJson(withDifferentClock))
	})

	test('covers the collector-stamped observation time', () => {
		const events = [event()]
		const moved = [{ ...events[0]!, observedAt: events[0]!.observedAt + 1 }]
		expect(canonicalBatchJson(events)).not.toBe(canonicalBatchJson(moved))
	})
})

describe('batchWindow', () => {
	test('spans the earliest and latest observation times, in chain seconds', () => {
		const window = batchWindow([
			event({ observedAt: CAMPAIGN_START + 10 }),
			event({ observedAt: CAMPAIGN_START + 90 }),
		])
		expect(window).toEqual({ start: CAMPAIGN_START + 10, end: CAMPAIGN_START + 90 })
	})

	test('is zero for an empty batch', () => {
		expect(batchWindow([])).toEqual({ start: 0, end: 0 })
	})
})
