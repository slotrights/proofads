import { describe, expect, it } from 'vitest'
import { QualificationClock, type MeasureEmission } from '../src/measure'

/** Drives the pure clock with an explicit virtual timeline — no real timers needed. */
function makeClock() {
	const emissions: MeasureEmission[] = []
	const clock = new QualificationClock({ onEmit: (e) => emissions.push(e) })
	clock.start(0)
	return { clock, emissions }
}

const qualified = (emissions: MeasureEmission[]) =>
	emissions.filter((e) => e.eventType === 'VIEW_10_SECONDS_REACHED')

describe('QualificationClock', () => {
	it('qualifies after 10 continuous seconds fully in view', () => {
		const { clock, emissions } = makeClock()
		clock.setIntersection(1, 0)
		clock.tick(10_000)
		expect(qualified(emissions)).toHaveLength(1)
		expect(clock.qualifyingMsElapsed).toBe(10_000)
	})

	it('does not qualify after only 5 seconds', () => {
		const { clock, emissions } = makeClock()
		clock.setIntersection(1, 0)
		clock.tick(5_000)
		expect(qualified(emissions)).toHaveLength(0)
	})

	it('accumulates across an interruption: 5s + hidden + 5s qualifies', () => {
		const { clock, emissions } = makeClock()
		clock.setIntersection(1, 0)
		clock.tick(5_000)
		clock.setPageVisible(false, 5_000)
		clock.tick(60_000) // a minute in another tab
		clock.setPageVisible(true, 60_000)
		clock.tick(65_000)
		expect(qualified(emissions)).toHaveLength(1)
		expect(clock.qualifyingMsElapsed).toBe(10_000)
	})

	it('does not count time while the tab is hidden', () => {
		const { clock, emissions } = makeClock()
		clock.setIntersection(1, 0)
		clock.setPageVisible(false, 0)
		clock.tick(30_000)
		expect(qualified(emissions)).toHaveLength(0)
		expect(clock.qualifyingMsElapsed).toBe(0)
	})

	it('does not count time below the 50% visibility threshold', () => {
		const { clock, emissions } = makeClock()
		clock.setIntersection(0.49, 0)
		clock.tick(30_000)
		expect(clock.qualifyingMsElapsed).toBe(0)
		expect(qualified(emissions)).toHaveLength(0)
	})

	it('counts time at exactly the 50% threshold', () => {
		const { clock } = makeClock()
		clock.setIntersection(0.5, 0)
		clock.tick(10_000)
		expect(clock.qualifyingMsElapsed).toBe(10_000)
	})

	it('emits the qualification exactly once however long the viewer stays', () => {
		const { clock, emissions } = makeClock()
		clock.setIntersection(1, 0)
		clock.tick(10_000)
		clock.tick(20_000)
		clock.tick(300_000)
		expect(qualified(emissions)).toHaveLength(1)
	})

	it('emits progress events every second of qualifying time', () => {
		const { clock, emissions } = makeClock()
		clock.setIntersection(1, 0)
		for (let t = 1_000; t <= 5_000; t += 1_000) clock.tick(t)
		const progress = emissions.filter((e) => e.eventType === 'QUALIFYING_TIME_PROGRESS')
		expect(progress).toHaveLength(5)
		expect(progress.at(-1)?.visibleMs).toBe(5_000)
	})

	it('only accrues while both the page and the slot are visible', () => {
		const { clock } = makeClock()
		clock.setPageVisible(true, 0)
		clock.setIntersection(0.2, 0)
		clock.tick(4_000)
		expect(clock.isAccruing).toBe(false)
		clock.setIntersection(0.8, 4_000)
		expect(clock.isAccruing).toBe(true)
		clock.tick(7_000)
		expect(clock.qualifyingMsElapsed).toBe(3_000)
	})

	it('ignores non-monotonic ticks', () => {
		const { clock } = makeClock()
		clock.setIntersection(1, 0)
		clock.tick(3_000)
		clock.tick(1_000)
		expect(clock.qualifyingMsElapsed).toBe(3_000)
	})

	it('starts with nothing accrued and nothing qualified', () => {
		const { clock, emissions } = makeClock()
		expect(clock.qualifyingMsElapsed).toBe(0)
		expect(clock.hasQualified).toBe(false)
		expect(emissions).toHaveLength(0)
	})
})
