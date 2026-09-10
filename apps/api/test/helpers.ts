import postgres from 'postgres'
import { CampaignStatus, labelhashOfSlot } from '@proofads/shared'
import { buildApp, type App } from '../src/app'
import { migrate, SCHEMA_SQL } from '../src/db/migrate'
import type { CampaignInfo, CampaignReader } from '../src/chain'

export const TEST_DATABASE_URL =
	process.env.TEST_DATABASE_URL ?? 'postgres://proofads@127.0.0.1:5433/proofads_test'

export const API_TOKEN = 'test-token-do-not-use-in-production'
export const CREATIVE_HASH = ('0x' + 'ab'.repeat(32)) as `0x${string}`

export function campaign(overrides: Partial<CampaignInfo> = {}): CampaignInfo {
	return {
		campaignId: 1,
		status: CampaignStatus.ACTIVE,
		slotLabelhash: labelhashOfSlot('hero'),
		creativeHash: CREATIVE_HASH,
		metric: 0,
		targetUnits: 2,
		verifiedUnits: 0,
		startTime: 1_757_000_000,
		deadline: 1_757_003_600,
		...overrides,
	}
}

export function readerFor(...list: CampaignInfo[]): CampaignReader {
	return async (id) => list.find((c) => c.campaignId === id) ?? null
}

export async function resetDatabase(): Promise<void> {
	const sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} })
	try {
		await sql.unsafe(SCHEMA_SQL)
		await sql.unsafe('TRUNCATE events, batches, sessions, world_verifications RESTART IDENTITY')
	} finally {
		await sql.end()
	}
}

/** Fixed chain clock: mid-campaign, so window rules are exercised deterministically. */
export const CHAIN_NOW = 1_757_000_600

export async function makeApp(reader: CampaignReader, chainNow: number = CHAIN_NOW): Promise<App> {
	await migrate(TEST_DATABASE_URL)
	return buildApp({
		databaseUrl: TEST_DATABASE_URL,
		apiToken: API_TOKEN,
		readCampaign: reader,
		chainNow: async () => chainNow,
	})
}

let counter = 0
export function measurementEvent(sessionId: string, overrides: Record<string, unknown> = {}) {
	counter += 1
	return {
		eventId: `evt-${counter}-${Math.random().toString(36).slice(2)}`,
		sessionId,
		campaignId: 1,
		eventType: 'VIEW_10_SECONDS_REACHED' as const,
		clientTime: 1_757_000_100_000,
		visibilityRatio: 0.9,
		visibleMs: 10_000,
		creativeHash: CREATIVE_HASH,
		origin: 'https://sepolia-times.local',
		slotLabel: 'hero',
		...overrides,
	}
}
