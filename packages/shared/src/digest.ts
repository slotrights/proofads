import { keccak256, toHex } from 'viem'
import type { MeasurementEvent } from './schemas'

/**
 * The canonical projection of an event used for the batch digest.
 *
 * Field order is fixed and the projection is deliberately narrow: the digest must be
 * reproducible byte-for-byte by three independent parties — the API when it closes the batch,
 * the enclave when it re-verifies what it fetched, and anyone auditing the batch afterwards.
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
		// Collector-stamped chain time. Covered by the digest because the enclave's campaign
		// window check depends on it.
		observedAt: event.observedAt ?? 0,
	}
}

/**
 * keccak256 over `JSON.stringify(events.map(canonicalEvent))`.
 *
 * Plain JSON on purpose (MVP rule 13): the enclave runs the identical function on the bytes
 * it received, so any tampering between the collector and the enclave changes the digest and
 * the workflow refuses to report.
 */
export function batchDigest(events: MeasurementEvent[]): `0x${string}` {
	return keccak256(toHex(JSON.stringify(events.map(canonicalEvent))))
}
