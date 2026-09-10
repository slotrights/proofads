import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import {
	batchDigest,
	CampaignStatus,
	createSessionSchema,
	eventBatchUploadSchema,
	labelhashOfSlot,
	type MeasurementEvent,
} from '@proofads/shared'
import { batches, events, sessions, worldVerifications } from './db/schema'
import type { CampaignReader, ChainClock } from './chain'

export type BuildOptions = {
	databaseUrl: string
	apiToken: string
	readCampaign: CampaignReader
	/** The collector's clock. Chain time, so delivery windows never depend on a browser clock. */
	chainNow: ChainClock
	sessionTtlSeconds?: number
	logger?: boolean
}

export type App = FastifyInstance & {
	db: PostgresJsDatabase
	closeDb: () => Promise<void>
}

/** Rows the collector stores, projected back into the shape the enclave verifies. */
function toMeasurementEvent(row: typeof events.$inferSelect): MeasurementEvent {
	return {
		eventId: row.eventId,
		sessionId: row.sessionId,
		campaignId: row.campaignId,
		eventType: row.eventType as MeasurementEvent['eventType'],
		clientTime: Number(row.clientTime),
		visibilityRatio: row.visibilityRatio,
		visibleMs: row.visibleMs,
		creativeHash: row.creativeHash as `0x${string}`,
		origin: row.origin,
		slotLabel: row.slotLabel,
		observedAt: Number(row.observedAt),
	}
}

export async function buildApp(options: BuildOptions): Promise<App> {
	const ttl = options.sessionTtlSeconds ?? 3600
	const sqlClient = postgres(options.databaseUrl, { max: 5, onnotice: () => {} })
	const db = drizzle(sqlClient)

	const app = Fastify({ logger: options.logger ?? false }) as unknown as App
	app.db = db
	app.closeDb = async () => {
		await sqlClient.end()
	}
	await app.register(cors, { origin: true })

	/** Guards `/internal/*`. The value is the Vault DON secret the enclave holds. */
	const requireBearer = (header: string | undefined): boolean =>
		typeof header === 'string' && header === `Bearer ${options.apiToken}`

	app.get('/health', async () => ({ ok: true }))

	// ── Sessions ──────────────────────────────────────────────────────────
	app.post('/sessions', async (request, reply) => {
		const parsed = createSessionSchema.safeParse(request.body)
		if (!parsed.success) return reply.code(400).send({ error: 'INVALID_BODY', detail: parsed.error.issues })

		const campaign = await options.readCampaign(parsed.data.campaignId)
		if (!campaign) return reply.code(404).send({ error: 'CAMPAIGN_NOT_FOUND' })
		if (campaign.status !== CampaignStatus.ACTIVE) {
			return reply.code(409).send({ error: 'CAMPAIGN_NOT_ACTIVE' })
		}
		if (campaign.slotLabelhash.toLowerCase() !== labelhashOfSlot(parsed.data.slotLabel).toLowerCase()) {
			return reply.code(409).send({ error: 'SLOT_MISMATCH' })
		}

		const id = randomUUID()
		const expiresAt = new Date(Date.now() + ttl * 1000)
		await db.insert(sessions).values({
			id,
			campaignId: parsed.data.campaignId,
			slotLabel: parsed.data.slotLabel,
			origin: parsed.data.origin,
			expiresAt,
		})
		return reply.code(201).send({
			sessionId: id,
			expiresAt: expiresAt.toISOString(),
			creativeHash: campaign.creativeHash,
			metric: campaign.metric,
		})
	})

	// ── Events ────────────────────────────────────────────────────────────
	app.post('/events', async (request, reply) => {
		const parsed = eventBatchUploadSchema.safeParse(request.body)
		if (!parsed.success) return reply.code(400).send({ error: 'INVALID_BODY', detail: parsed.error.issues })

		const [session] = await db.select().from(sessions).where(eq(sessions.id, parsed.data.sessionId))
		if (!session) return reply.code(404).send({ error: 'UNKNOWN_SESSION' })
		if (session.expiresAt.getTime() < Date.now()) return reply.code(410).send({ error: 'SESSION_EXPIRED' })

		const campaign = await options.readCampaign(session.campaignId)
		if (!campaign) return reply.code(404).send({ error: 'CAMPAIGN_NOT_FOUND' })

		// One chain read per upload, not per event.
		const observedAt = await options.chainNow()

		let accepted = 0
		let rejected = 0
		for (const event of parsed.data.events) {
			// Cross-checks the SDK cannot be trusted to have done.
			if (event.sessionId !== session.id) { rejected++; continue }
			if (event.campaignId !== session.campaignId) { rejected++; continue }
			if (event.slotLabel !== session.slotLabel) { rejected++; continue }
			if (event.creativeHash.toLowerCase() !== campaign.creativeHash.toLowerCase()) { rejected++; continue }

			const inserted = await db
				.insert(events)
				.values({
					eventId: event.eventId,
					campaignId: event.campaignId,
					sessionId: event.sessionId,
					eventType: event.eventType,
					slotLabel: event.slotLabel,
					clientTime: String(event.clientTime),
					visibilityRatio: event.visibilityRatio,
					visibleMs: event.visibleMs,
					creativeHash: event.creativeHash.toLowerCase(),
					origin: event.origin,
					observedAt: String(observedAt),
				})
				.onConflictDoNothing({ target: events.eventId })
				.returning({ sequence: events.sequence })
			if (inserted.length > 0) accepted++
			else rejected++
		}
		return reply.code(202).send({ accepted, rejected })
	})

	// ── Batch closing (admin) ─────────────────────────────────────────────
	app.post('/internal/batches/close', async (request, reply) => {
		if (!requireBearer(request.headers.authorization)) return reply.code(403).send({ error: 'FORBIDDEN' })
		const body = request.body as { campaignId?: number; previouslySettledUnits?: number }
		if (typeof body?.campaignId !== 'number') return reply.code(400).send({ error: 'INVALID_BODY' })

		const campaign = await options.readCampaign(body.campaignId)
		if (!campaign) return reply.code(404).send({ error: 'CAMPAIGN_NOT_FOUND' })

		const pending = await db
			.select()
			.from(events)
			.where(and(eq(events.campaignId, body.campaignId), isNull(events.batchId)))
			.orderBy(asc(events.sequence))

		if (pending.length === 0) return reply.code(409).send({ error: 'NO_PENDING_EVENTS' })

		const projected = pending.map(toMeasurementEvent)
		const id = randomUUID()
		const digest = batchDigest(projected)
		const settled = body.previouslySettledUnits ?? campaign.verifiedUnits

		await db.insert(batches).values({
			id,
			campaignId: body.campaignId,
			firstSequence: String(pending[0]!.sequence),
			lastSequence: String(pending[pending.length - 1]!.sequence),
			eventCount: pending.length,
			digest,
			previouslySettledUnits: settled,
		})
		// The only mutation an event row ever receives, and only while batch_id is still null.
		await db
			.update(events)
			.set({ batchId: id })
			.where(and(eq(events.campaignId, body.campaignId), isNull(events.batchId)))

		return reply.code(201).send({ batchId: id, digest, eventCount: pending.length })
	})

	// ── Batch retrieval (the enclave) ─────────────────────────────────────
	app.get<{ Params: { id: string } }>('/internal/batches/:id', async (request, reply) => {
		if (!requireBearer(request.headers.authorization)) return reply.code(403).send({ error: 'FORBIDDEN' })

		const [batch] = await db.select().from(batches).where(eq(batches.id, request.params.id))
		if (!batch) return reply.code(404).send({ error: 'BATCH_NOT_FOUND' })

		const rows = await db
			.select()
			.from(events)
			.where(eq(events.batchId, batch.id))
			.orderBy(asc(events.sequence))

		const campaign = await options.readCampaign(batch.campaignId)
		if (!campaign) return reply.code(404).send({ error: 'CAMPAIGN_NOT_FOUND' })

		const sessionIds = [...new Set(rows.map((r) => r.sessionId))]
		const verified = sessionIds.length
			? await db
					.select({ sessionId: worldVerifications.sessionId })
					.from(worldVerifications)
					.where(eq(worldVerifications.campaignId, batch.campaignId))
			: []
		const verifiedSet = new Set(verified.map((v) => v.sessionId))

		return reply.send({
			batch: {
				id: batch.id,
				campaignId: batch.campaignId,
				firstSequence: String(batch.firstSequence),
				lastSequence: String(batch.lastSequence),
				eventCount: batch.eventCount,
				digest: batch.digest,
				closedAt: batch.closedAt.toISOString(),
			},
			campaign: {
				campaignId: batch.campaignId,
				slotLabel: rows[0]?.slotLabel ?? '',
				creativeHash: campaign.creativeHash,
				metric: campaign.metric,
				targetUnits: campaign.targetUnits,
				startTime: campaign.startTime,
				deadline: campaign.deadline,
				previouslySettledUnits: batch.previouslySettledUnits,
			},
			// Booleans only. A nullifier never leaves this database.
			sessions: sessionIds.map((sessionId) => ({
				sessionId,
				worldEligible: verifiedSet.has(sessionId),
			})),
			events: rows.map(toMeasurementEvent),
		})
	})

	// ── Public summary ────────────────────────────────────────────────────
	app.get<{ Params: { id: string } }>('/campaigns/:id/summary', async (request, reply) => {
		const campaignId = Number(request.params.id)
		if (!Number.isInteger(campaignId) || campaignId <= 0) return reply.code(400).send({ error: 'INVALID_ID' })

		const [counts] = await db
			.select({
				total: sql<number>`count(*)::int`,
				qualified: sql<number>`count(*) filter (where ${events.eventType} = 'VIEW_10_SECONDS_REACHED')::int`,
				sessions: sql<number>`count(distinct ${events.sessionId})::int`,
				unbatched: sql<number>`count(*) filter (where ${events.batchId} is null)::int`,
			})
			.from(events)
			.where(eq(events.campaignId, campaignId))

		const batchRows = await db
			.select({ id: batches.id, digest: batches.digest, eventCount: batches.eventCount, closedAt: batches.closedAt })
			.from(batches)
			.where(eq(batches.campaignId, campaignId))

		return reply.send({
			campaignId,
			totalEvents: counts?.total ?? 0,
			qualifyingEvents: counts?.qualified ?? 0,
			distinctSessions: counts?.sessions ?? 0,
			unbatchedEvents: counts?.unbatched ?? 0,
			batches: batchRows.map((b) => ({ ...b, closedAt: b.closedAt.toISOString() })),
		})
	})

	return app
}
