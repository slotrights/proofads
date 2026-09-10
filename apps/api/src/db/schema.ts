import {
	bigserial,
	boolean,
	index,
	integer,
	numeric,
	pgTable,
	real,
	text,
	timestamp,
	uniqueIndex,
} from 'drizzle-orm/pg-core'

/**
 * One viewer session on one campaign. Created by the SDK before any event is accepted, so a
 * campaign that is not ACTIVE on chain can never accumulate measurement data.
 */
export const sessions = pgTable('sessions', {
	id: text('id').primaryKey(),
	campaignId: integer('campaign_id').notNull(),
	slotLabel: text('slot_label').notNull(),
	origin: text('origin').notNull(),
	/** Set only by the World verification route. False in this MVP. */
	worldVerified: boolean('world_verified').notNull().default(false),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

/**
 * Raw measurement events. Append-only: the only column ever updated is `batch_id`, and only
 * once, when a batch is closed.
 */
export const events = pgTable(
	'events',
	{
		sequence: bigserial('sequence', { mode: 'bigint' }).primaryKey(),
		eventId: text('event_id').notNull(),
		campaignId: integer('campaign_id').notNull(),
		sessionId: text('session_id').notNull(),
		eventType: text('event_type').notNull(),
		slotLabel: text('slot_label').notNull(),
		clientTime: numeric('client_time').notNull(),
		serverTime: timestamp('server_time', { withTimezone: true }).notNull().defaultNow(),
		visibilityRatio: real('visibility_ratio').notNull(),
		visibleMs: integer('visible_ms').notNull(),
		creativeHash: text('creative_hash').notNull(),
		origin: text('origin').notNull(),
		batchId: text('batch_id'),
		/** Chain time (unix seconds) when the collector accepted the event. */
		observedAt: numeric('observed_at').notNull().default('0'),
	},
	(t) => [
		uniqueIndex('events_event_id_key').on(t.eventId),
		index('events_campaign_batch_idx').on(t.campaignId, t.batchId),
	],
)

/**
 * A closed, immutable measurement batch. Rows are inserted once and never updated. Closing
 * twice produces two batches; the first is untouched.
 */
export const batches = pgTable('batches', {
	id: text('id').primaryKey(),
	campaignId: integer('campaign_id').notNull(),
	firstSequence: numeric('first_sequence').notNull(),
	lastSequence: numeric('last_sequence').notNull(),
	eventCount: integer('event_count').notNull(),
	digest: text('digest').notNull(),
	closedAt: timestamp('closed_at', { withTimezone: true }).notNull().defaultNow(),
	/** Cumulative units already settled on chain when this batch was closed. */
	previouslySettledUnits: integer('previously_settled_units').notNull().default(0),
})

/**
 * World Selfie Check verifications, one row per (campaign, session). Never populated in this
 * MVP — the table and the nullifier column exist so Phase 2 can turn the premium metric on
 * without a migration. The nullifier is stored as NUMERIC(78,0) per World's guidance and is
 * never included in what the enclave receives.
 */
export const worldVerifications = pgTable(
	'world_verifications',
	{
		campaignId: integer('campaign_id').notNull(),
		sessionId: text('session_id').notNull(),
		nullifier: numeric('nullifier', { precision: 78, scale: 0 }).notNull(),
		verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex('world_campaign_session_key').on(t.campaignId, t.sessionId),
		uniqueIndex('world_campaign_nullifier_key').on(t.campaignId, t.nullifier),
	],
)
