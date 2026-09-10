import { z } from 'zod'
import { EVENT_TYPES } from './enums'

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'expected a 32-byte hex string')
const uuidish = z.string().min(8).max(128)

/**
 * A single raw measurement event produced by the browser SDK.
 *
 * Every field here is data the publisher's page observed about one viewer session. This is
 * exactly the kind of payload that must NOT be handed to a public blockchain or to node
 * operators, which is why qualification happens inside the Chainlink TEE and only an
 * aggregate crosses back out.
 */
export const measurementEventSchema = z.object({
	eventId: uuidish,
	sessionId: uuidish,
	campaignId: z.number().int().nonnegative(),
	eventType: z.enum(EVENT_TYPES),
	/** Client clock, milliseconds since epoch. Advisory only; the server stamps its own time. */
	clientTime: z.number().int().nonnegative(),
	/** Fraction of the creative inside the viewport at the time of the event, 0..1. */
	visibilityRatio: z.number().min(0).max(1),
	/** Cumulative qualifying milliseconds for this session at the time of the event. */
	visibleMs: z.number().int().nonnegative(),
	/** keccak256 of the exact creative bytes the browser rendered. */
	creativeHash: hex32,
	/** Origin the SDK was mounted on. */
	origin: z.string().min(1).max(255),
	/** ENS label of the slot the creative was rendered in, e.g. "hero". */
	slotLabel: z.string().min(1).max(63),
	/**
	 * Chain time (unix seconds) at which the collector accepted this event.
	 *
	 * Set by the collector from the latest block, never by the browser. Delivery decisions use
	 * this and not `clientTime`, so a viewer cannot move an event into a campaign window by
	 * changing their system clock. Optional on upload; the collector overwrites whatever
	 * arrives.
	 */
	observedAt: z.number().int().nonnegative().optional(),
})
export type MeasurementEvent = z.infer<typeof measurementEventSchema>

export const eventBatchUploadSchema = z.object({
	sessionId: uuidish,
	events: z.array(measurementEventSchema).min(1).max(200),
})
export type EventBatchUpload = z.infer<typeof eventBatchUploadSchema>

export const createSessionSchema = z.object({
	campaignId: z.number().int().positive(),
	slotLabel: z.string().min(1).max(63),
	origin: z.string().min(1).max(255),
})
export type CreateSession = z.infer<typeof createSessionSchema>

/**
 * An immutable, closed measurement batch. Once written, rows are never updated; a second
 * close produces a second batch. `digest` is keccak256 over the canonical event projection,
 * and it is recomputed inside the enclave before the batch is trusted.
 */
export const batchSchema = z.object({
	id: z.string(),
	campaignId: z.number().int().positive(),
	firstSequence: z.string(),
	lastSequence: z.string(),
	eventCount: z.number().int().nonnegative(),
	digest: hex32,
	closedAt: z.string(),
})
export type Batch = z.infer<typeof batchSchema>

/** Per-session flags the enclave needs but that reveal nothing about the person. */
export const batchSessionSchema = z.object({
	sessionId: uuidish,
	/** True only when a World Selfie Check credential was verified for this session. */
	worldEligible: z.boolean(),
})
export type BatchSession = z.infer<typeof batchSessionSchema>

/** What `GET /internal/batches/:id` returns to the enclave. Bearer-token protected. */
export const batchPayloadSchema = z.object({
	batch: batchSchema,
	campaign: z.object({
		campaignId: z.number().int().positive(),
		slotLabel: z.string(),
		creativeHash: hex32,
		metric: z.number().int().min(0).max(1),
		targetUnits: z.number().int().positive(),
		startTime: z.number().int().nonnegative(),
		deadline: z.number().int().nonnegative(),
		previouslySettledUnits: z.number().int().nonnegative(),
	}),
	sessions: z.array(batchSessionSchema),
	events: z.array(measurementEventSchema),
})
export type BatchPayload = z.infer<typeof batchPayloadSchema>

/** The only thing that leaves the enclave. */
export const settlementReportSchema = z.object({
	campaignId: z.number().int().positive(),
	cumulativeVerifiedUnits: z.number().int().nonnegative(),
	batchDigest: hex32,
	windowStart: z.number().int().nonnegative(),
	windowEnd: z.number().int().nonnegative(),
})
export type SettlementReport = z.infer<typeof settlementReportSchema>
