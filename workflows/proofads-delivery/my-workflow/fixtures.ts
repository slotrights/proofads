import { keccak256, toHex } from 'viem'
import { canonicalBatchJson } from './qualify'
import { METRIC_VIEW_10_SECONDS, type BatchPayload, type MeasurementEvent } from './types'

export const CREATIVE = ('0x' + 'ab'.repeat(32)) as `0x${string}`
export const CAMPAIGN_START = 1_757_000_000 // seconds
export const CAMPAIGN_DEADLINE = CAMPAIGN_START + 1200

let n = 0
export function event(overrides: Partial<MeasurementEvent> = {}): MeasurementEvent {
	n += 1
	return {
		eventId: `evt-${n}`,
		sessionId: `sess-${n}`,
		campaignId: 1,
		eventType: 'VIEW_10_SECONDS_REACHED',
		clientTime: (CAMPAIGN_START + 60) * 1000,
		observedAt: CAMPAIGN_START + 60,
		visibilityRatio: 0.9,
		visibleMs: 10_000,
		creativeHash: CREATIVE,
		origin: 'https://sepolia-times.local',
		slotLabel: 'hero',
		...overrides,
	}
}

/** Builds a payload whose digest is correct for its events, like a real closed batch. */
export function payload(
	events: MeasurementEvent[],
	overrides: {
		metric?: number
		targetUnits?: number
		previouslySettledUnits?: number
		worldEligible?: Record<string, boolean>
		sessions?: { sessionId: string; worldEligible: boolean }[]
		digest?: string
		campaignId?: number
	} = {},
): BatchPayload {
	const sessionIds = [...new Set(events.map((e) => e.sessionId))]
	return {
		batch: {
			id: 'batch-1',
			campaignId: overrides.campaignId ?? 1,
			firstSequence: '1',
			lastSequence: String(events.length),
			eventCount: events.length,
			digest: overrides.digest ?? keccak256(toHex(canonicalBatchJson(events))),
			closedAt: new Date(CAMPAIGN_DEADLINE * 1000).toISOString(),
		},
		campaign: {
			campaignId: overrides.campaignId ?? 1,
			slotLabel: 'hero',
			creativeHash: CREATIVE,
			metric: overrides.metric ?? METRIC_VIEW_10_SECONDS,
			targetUnits: overrides.targetUnits ?? 2,
			startTime: CAMPAIGN_START,
			deadline: CAMPAIGN_DEADLINE,
			previouslySettledUnits: overrides.previouslySettledUnits ?? 0,
		},
		sessions:
			overrides.sessions ??
			sessionIds.map((sessionId) => ({
				sessionId,
				worldEligible: overrides.worldEligible?.[sessionId] ?? false,
			})),
		events,
	}
}
