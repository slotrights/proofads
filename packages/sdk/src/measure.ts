import { MIN_VISIBLE_RATIO, QUALIFYING_MS, type EventType } from '@proofads/shared'

export type MeasureEmission = {
	eventType: EventType
	visibleMs: number
	visibilityRatio: number
	atMs: number
}

export type MeasureOptions = {
	qualifyingMs?: number
	minVisibleRatio?: number
	/** Emit a progress event every N milliseconds of *qualifying* time. */
	progressEveryMs?: number
	onEmit: (emission: MeasureEmission) => void
}

/**
 * The qualification clock.
 *
 * Deliberately pure: it owns no timers, no DOM and no clock. Callers push `tick(nowMs)`,
 * `setIntersection(ratio, nowMs)` and `setPageVisible(visible, nowMs)` into it. That is what
 * makes every rule below testable with fake timers rather than a headless browser.
 *
 * Time accrues only while BOTH hold:
 *   - at least `minVisibleRatio` of the creative is inside the viewport, and
 *   - the page itself is visible (`document.visibilityState === 'visible'`).
 *
 * `VIEW_10_SECONDS_REACHED` is emitted exactly once per instance, no matter how long the
 * viewer stays. One session can therefore never earn more than one unit.
 */
export class QualificationClock {
	private readonly qualifyingMs: number
	private readonly minVisibleRatio: number
	private readonly progressEveryMs: number
	private readonly onEmit: (emission: MeasureEmission) => void

	private accumulatedMs = 0
	private lastTickMs: number | null = null
	private ratio = 0
	private pageVisible = true
	private reached = false
	private lastProgressAt = 0

	constructor(options: MeasureOptions) {
		this.qualifyingMs = options.qualifyingMs ?? QUALIFYING_MS
		this.minVisibleRatio = options.minVisibleRatio ?? MIN_VISIBLE_RATIO
		this.progressEveryMs = options.progressEveryMs ?? 1_000
		this.onEmit = options.onEmit
	}

	get qualifyingMsElapsed(): number {
		return this.accumulatedMs
	}

	get hasQualified(): boolean {
		return this.reached
	}

	get isAccruing(): boolean {
		return this.pageVisible && this.ratio >= this.minVisibleRatio
	}

	start(nowMs: number): void {
		this.lastTickMs = nowMs
	}

	setIntersection(ratio: number, nowMs: number): void {
		this.tick(nowMs)
		this.ratio = ratio
		this.onEmit({
			eventType: 'VISIBILITY_CHANGED',
			visibleMs: this.accumulatedMs,
			visibilityRatio: ratio,
			atMs: nowMs,
		})
	}

	setPageVisible(visible: boolean, nowMs: number): void {
		this.tick(nowMs)
		this.pageVisible = visible
		this.onEmit({
			eventType: 'VISIBILITY_CHANGED',
			visibleMs: this.accumulatedMs,
			visibilityRatio: visible ? this.ratio : 0,
			atMs: nowMs,
		})
	}

	/** Advance the clock to `nowMs`, accruing only the qualifying part of the interval. */
	tick(nowMs: number): void {
		if (this.lastTickMs === null) {
			this.lastTickMs = nowMs
			return
		}
		const delta = nowMs - this.lastTickMs
		this.lastTickMs = nowMs
		if (delta <= 0) return
		if (!this.isAccruing) return

		this.accumulatedMs += delta

		if (this.accumulatedMs - this.lastProgressAt >= this.progressEveryMs && !this.reached) {
			this.lastProgressAt = this.accumulatedMs - (this.accumulatedMs % this.progressEveryMs)
			this.onEmit({
				eventType: 'QUALIFYING_TIME_PROGRESS',
				visibleMs: this.accumulatedMs,
				visibilityRatio: this.ratio,
				atMs: nowMs,
			})
		}

		if (!this.reached && this.accumulatedMs >= this.qualifyingMs) {
			this.reached = true
			this.onEmit({
				eventType: 'VIEW_10_SECONDS_REACHED',
				visibleMs: this.accumulatedMs,
				visibilityRatio: this.ratio,
				atMs: nowMs,
			})
		}
	}
}
