/**
 * Schema bootstrap. Plain SQL rather than a migration toolchain: the MVP has four tables and
 * one shape (MVP rule 13). Idempotent — safe to run on every boot.
 */
import postgres from 'postgres'

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id             TEXT PRIMARY KEY,
  campaign_id    INTEGER NOT NULL,
  slot_label     TEXT NOT NULL,
  origin         TEXT NOT NULL,
  world_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  sequence         BIGSERIAL PRIMARY KEY,
  event_id         TEXT NOT NULL,
  campaign_id      INTEGER NOT NULL,
  session_id       TEXT NOT NULL,
  event_type       TEXT NOT NULL,
  slot_label       TEXT NOT NULL,
  client_time      NUMERIC NOT NULL,
  server_time      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  visibility_ratio REAL NOT NULL,
  visible_ms       INTEGER NOT NULL,
  creative_hash    TEXT NOT NULL,
  origin           TEXT NOT NULL,
  batch_id         TEXT,
  observed_at      BIGINT NOT NULL DEFAULT 0
);
ALTER TABLE events ADD COLUMN IF NOT EXISTS observed_at BIGINT NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS events_event_id_key ON events (event_id);
CREATE INDEX IF NOT EXISTS events_campaign_batch_idx ON events (campaign_id, batch_id);

CREATE TABLE IF NOT EXISTS batches (
  id                       TEXT PRIMARY KEY,
  campaign_id              INTEGER NOT NULL,
  first_sequence           NUMERIC NOT NULL,
  last_sequence            NUMERIC NOT NULL,
  event_count              INTEGER NOT NULL,
  digest                   TEXT NOT NULL,
  closed_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  previously_settled_units INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS world_verifications (
  campaign_id  INTEGER NOT NULL,
  session_id   TEXT NOT NULL,
  nullifier    NUMERIC(78,0) NOT NULL,
  verified_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS world_campaign_session_key ON world_verifications (campaign_id, session_id);
CREATE UNIQUE INDEX IF NOT EXISTS world_campaign_nullifier_key ON world_verifications (campaign_id, nullifier);
`

export async function migrate(databaseUrl: string): Promise<void> {
	const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} })
	try {
		await sql.unsafe(SCHEMA_SQL)
	} finally {
		await sql.end()
	}
}

if (process.argv[1]?.endsWith('migrate.ts')) {
	const url = process.env.DATABASE_URL
	if (!url) throw new Error('DATABASE_URL is required')
	await migrate(url)
	console.log('Schema ready.')
}
