/**
 * The shapes the enclave works with.
 *
 * Duplicated from `@proofads/shared` rather than imported: the workflow is compiled to WASM by
 * the CRE toolchain and must not pull the pnpm workspace graph in with it. `qualify.test.ts`
 * pins these against the collector's real output.
 */

export type MeasurementEvent = {
	eventId: string
	sessionId: string
	campaignId: number
	eventType: string
	clientTime: number
	visibilityRatio: number
	visibleMs: number
	creativeHash: string
	origin: string
	slotLabel: string
	/**
	 * Chain time (unix seconds) at which the collector accepted the event. Stamped by the
	 * collector from the latest block; never supplied by the browser.
	 */
	observedAt: number
}

export type BatchSession = {
	sessionId: string
	/** True only when a World Selfie Check credential was verified. Never a nullifier. */
	worldEligible: boolean
}

export type BatchMeta = {
	id: string
	campaignId: number
	firstSequence: string
	lastSequence: string
	eventCount: number
	digest: string
	closedAt: string
}

export type CampaignMeta = {
	campaignId: number
	slotLabel: string
	creativeHash: string
	/** 0 = VIEW_10_SECONDS, 1 = SELFIE_CHECKED_VIEW_10_SECONDS */
	metric: number
	targetUnits: number
	startTime: number
	deadline: number
	previouslySettledUnits: number
}

export type BatchPayload = {
	batch: BatchMeta
	campaign: CampaignMeta
	sessions: BatchSession[]
	events: MeasurementEvent[]
}

export const METRIC_VIEW_10_SECONDS = 0
export const METRIC_SELFIE_CHECKED_VIEW_10_SECONDS = 1

/** Milliseconds of qualifying visibility a session must accrue to earn one unit. */
export const QUALIFYING_MS = 10_000

/** Minimum share of the creative that must be in the viewport while time accrues. */
export const MIN_VISIBLE_RATIO = 0.5
