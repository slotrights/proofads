import {
	METRIC_SELFIE_CHECKED_VIEW_10_SECONDS,
	MIN_VISIBLE_RATIO,
	QUALIFYING_MS,
	type BatchPayload,
	type MeasurementEvent,
} from './types'

export type RejectionReason =
	| 'WRONG_CAMPAIGN'
	| 'WRONG_SLOT'
	| 'WRONG_CREATIVE'
	| 'NOT_A_QUALIFYING_EVENT'
	| 'SHORT_VIEW'
	| 'NOT_VISIBLE_ENOUGH'
	| 'OUTSIDE_CAMPAIGN_WINDOW'
	| 'SESSION_ALREADY_COUNTED'
	| 'WORLD_ELIGIBILITY_MISSING'
	| 'UNKNOWN_SESSION'

export type QualificationResult = {
	/** Units earned by this batch alone. */
	newlyCountedUnits: number
	/**
	 * `alreadySettledUnits + newlyCountedUnits`, capped at the campaign target — what the contract
	 * should be told. The caller supplies `alreadySettledUnits`; the workflow reads it from the
	 * marketplace rather than from the measurement collector.
	 */
	cumulativeVerifiedUnits: number
	/** Sessions that earned a unit in this batch, in first-seen order. */
	countedSessions: string[]
	/** Counts per rejection reason. Diagnostic only; never leaves the enclave. */
	rejections: Record<RejectionReason, number>
}

function emptyRejections(): Record<RejectionReason, number> {
	return {
		WRONG_CAMPAIGN: 0,
		WRONG_SLOT: 0,
		WRONG_CREATIVE: 0,
		NOT_A_QUALIFYING_EVENT: 0,
		SHORT_VIEW: 0,
		NOT_VISIBLE_ENOUGH: 0,
		OUTSIDE_CAMPAIGN_WINDOW: 0,
		SESSION_ALREADY_COUNTED: 0,
		WORLD_ELIGIBILITY_MISSING: 0,
		UNKNOWN_SESSION: 0,
	}
}

/**
 * Decide how much delivery a measurement batch is worth.
 *
 * This is the whole reason ProofAds needs a confidential workflow. The inputs are per-session
 * viewing traces — visibility timelines, client timestamps, session identifiers, and (when the
 * premium metric is on) whether a person passed a liveness check. Running this on a public
 * chain would publish a viewing log; running it on ordinary DON nodes would hand that log to
 * node operators. Running it in an attested enclave keeps the inputs private and lets exactly
 * one number out.
 *
 * Plain loops, no classes, no strategy objects (MVP rule 13): every judge and every auditor
 * should be able to read the rules straight down the page.
 */
export function qualify(payload: BatchPayload, alreadySettledUnits?: number): QualificationResult {
	const { campaign, events, sessions } = payload
	const rejections = emptyRejections()
	const eligibleSessions = new Map<string, boolean>()
	for (const session of sessions) {
		eligibleSessions.set(session.sessionId, session.worldEligible)
	}

	const expectedCreative = campaign.creativeHash.toLowerCase()
	const requiresWorld = campaign.metric === METRIC_SELFIE_CHECKED_VIEW_10_SECONDS

	const counted: string[] = []
	const countedSet = new Set<string>()

	for (const event of events) {
		const reason = rejectionFor(event)
		if (reason) {
			rejections[reason] += 1
			continue
		}
		counted.push(event.sessionId)
		countedSet.add(event.sessionId)
	}

	function rejectionFor(event: MeasurementEvent): RejectionReason | null {
		if (event.campaignId !== campaign.campaignId) return 'WRONG_CAMPAIGN'
		if (event.slotLabel !== campaign.slotLabel) return 'WRONG_SLOT'
		if (event.creativeHash.toLowerCase() !== expectedCreative) return 'WRONG_CREATIVE'
		if (event.eventType !== 'VIEW_10_SECONDS_REACHED') return 'NOT_A_QUALIFYING_EVENT'
		if (event.visibleMs < QUALIFYING_MS) return 'SHORT_VIEW'
		if (event.visibilityRatio < MIN_VISIBLE_RATIO) return 'NOT_VISIBLE_ENOUGH'
		// The window is judged on the collector's chain-time stamp, never on `event.clientTime`:
		// a viewer must not be able to move a view into a campaign window by changing the clock
		// on their own machine.
		if (event.observedAt < campaign.startTime || event.observedAt > campaign.deadline) {
			return 'OUTSIDE_CAMPAIGN_WINDOW'
		}
		if (!eligibleSessions.has(event.sessionId)) return 'UNKNOWN_SESSION'
		if (requiresWorld && eligibleSessions.get(event.sessionId) !== true) {
			return 'WORLD_ELIGIBILITY_MISSING'
		}
		// One unit per session per campaign, whatever the browser sends.
		if (countedSet.has(event.sessionId)) return 'SESSION_ALREADY_COUNTED'
		return null
	}

	const newlyCountedUnits = counted.length
	// `alreadySettledUnits` comes from the marketplace when the workflow runs for real. The
	// payload's `previouslySettledUnits` is only a fallback for tests and for the collector's UI:
	// letting the collector define what has already been paid would put it back in the arithmetic
	// it is least trusted with.
	const settled = alreadySettledUnits ?? campaign.previouslySettledUnits
	const rawCumulative = settled + newlyCountedUnits
	const cumulativeVerifiedUnits = Math.min(rawCumulative, campaign.targetUnits)

	return { newlyCountedUnits, cumulativeVerifiedUnits, countedSessions: counted, rejections }
}

/**
 * The digest the collector published, recomputed from the bytes the enclave actually received.
 *
 * Must stay byte-identical to `@proofads/shared`'s `batchDigest`. If they ever diverge, the
 * workflow refuses to report rather than settling against data it cannot verify.
 */
export function canonicalEvent(event: MeasurementEvent) {
	return {
		eventId: event.eventId,
		sessionId: event.sessionId,
		campaignId: event.campaignId,
		eventType: event.eventType,
		visibleMs: event.visibleMs,
		visibilityRatio: event.visibilityRatio,
		creativeHash: event.creativeHash.toLowerCase(),
		slotLabel: event.slotLabel,
		origin: event.origin,
		observedAt: event.observedAt ?? 0,
	}
}

export function canonicalBatchJson(events: MeasurementEvent[]): string {
	return JSON.stringify(events.map(canonicalEvent))
}

/**
 * The measurement window covered by a batch, in chain seconds. Reported on chain so anyone can
 * see which slice of time a settlement refers to.
 */
export function batchWindow(events: MeasurementEvent[]): { start: number; end: number } {
	if (events.length === 0) return { start: 0, end: 0 }
	let start = Number.MAX_SAFE_INTEGER
	let end = 0
	for (const event of events) {
		if (event.observedAt < start) start = event.observedAt
		if (event.observedAt > end) end = event.observedAt
	}
	return { start, end }
}
