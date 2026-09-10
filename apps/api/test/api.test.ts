import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CampaignStatus, batchDigest } from '@proofads/shared'
import {
	API_TOKEN,
	CHAIN_NOW,
	CREATIVE_HASH,
	campaign,
	makeApp,
	measurementEvent,
	readerFor,
	resetDatabase,
} from './helpers'
import type { App } from '../src/app'

let app: App

async function newSession(campaignId = 1, slotLabel = 'hero') {
	const res = await app.inject({
		method: 'POST',
		url: '/sessions',
		payload: { campaignId, slotLabel, origin: 'https://sepolia-times.local' },
	})
	return res
}

describe('measurement API', () => {
	beforeEach(async () => {
		await resetDatabase()
		app = await makeApp(readerFor(campaign()))
	})

	afterEach(async () => {
		await app.close()
		await app.closeDb()
	})

	// ── Sessions ────────────────────────────────────────────────────────
	it('creates a session for an active campaign and returns the on-chain creative hash', async () => {
		const res = await newSession()
		expect(res.statusCode).toBe(201)
		const body = res.json()
		expect(body.sessionId).toBeTruthy()
		expect(body.creativeHash).toBe(CREATIVE_HASH)
	})

	it('rejects a session for an unknown campaign', async () => {
		const res = await newSession(99)
		expect(res.statusCode).toBe(404)
	})

	it('rejects a session for a slot the campaign is not for', async () => {
		const res = await newSession(1, 'sidebar')
		expect(res.statusCode).toBe(409)
		expect(res.json().error).toBe('SLOT_MISMATCH')
	})

	it('rejects a session once the campaign is closed', async () => {
		await app.close()
		await app.closeDb()
		app = await makeApp(readerFor(campaign({ status: CampaignStatus.CLOSED })))
		const res = await newSession()
		expect(res.statusCode).toBe(409)
		expect(res.json().error).toBe('CAMPAIGN_NOT_ACTIVE')
	})

	it('rejects a malformed session body', async () => {
		const res = await app.inject({ method: 'POST', url: '/sessions', payload: { campaignId: 'one' } })
		expect(res.statusCode).toBe(400)
	})

	// ── Events ──────────────────────────────────────────────────────────
	it('accepts well-formed events', async () => {
		const { sessionId } = (await newSession()).json()
		const res = await app.inject({
			method: 'POST',
			url: '/events',
			payload: { sessionId, events: [measurementEvent(sessionId)] },
		})
		expect(res.statusCode).toBe(202)
		expect(res.json()).toEqual({ accepted: 1, rejected: 0 })
	})

	it('rejects events whose schema is wrong', async () => {
		const { sessionId } = (await newSession()).json()
		const res = await app.inject({
			method: 'POST',
			url: '/events',
			payload: { sessionId, events: [measurementEvent(sessionId, { visibilityRatio: 7 })] },
		})
		expect(res.statusCode).toBe(400)
	})

	it('deduplicates a replayed eventId', async () => {
		const { sessionId } = (await newSession()).json()
		const event = measurementEvent(sessionId)
		await app.inject({ method: 'POST', url: '/events', payload: { sessionId, events: [event] } })
		const again = await app.inject({ method: 'POST', url: '/events', payload: { sessionId, events: [event] } })
		expect(again.json()).toEqual({ accepted: 0, rejected: 1 })
	})

	it('rejects an event whose creative hash is not the campaign creative', async () => {
		const { sessionId } = (await newSession()).json()
		const res = await app.inject({
			method: 'POST',
			url: '/events',
			payload: {
				sessionId,
				events: [measurementEvent(sessionId, { creativeHash: '0x' + 'cd'.repeat(32) })],
			},
		})
		expect(res.json()).toEqual({ accepted: 0, rejected: 1 })
	})

	it('stamps every event with chain time, overwriting whatever the browser sent', async () => {
		const { sessionId } = (await newSession()).json()
		await app.inject({
			method: 'POST',
			url: '/events',
			// A viewer whose clock says 1970 must not be able to influence the record.
			payload: { sessionId, events: [measurementEvent(sessionId, { clientTime: 0, observedAt: 1 })] },
		})
		const created = (
			await app.inject({
				method: 'POST',
				url: '/internal/batches/close',
				headers: { authorization: `Bearer ${API_TOKEN}` },
				payload: { campaignId: 1 },
			})
		).json()
		const payload = (
			await app.inject({
				method: 'GET',
				url: `/internal/batches/${created.batchId}`,
				headers: { authorization: `Bearer ${API_TOKEN}` },
			})
		).json()
		expect(payload.events[0].observedAt).toBe(CHAIN_NOW)
		expect(payload.events[0].clientTime).toBe(0)
	})

	it('rejects events for an unknown session', async () => {
		const res = await app.inject({
			method: 'POST',
			url: '/events',
			payload: { sessionId: 'no-such-session', events: [measurementEvent('no-such-session')] },
		})
		expect(res.statusCode).toBe(404)
	})

	// ── Batches ─────────────────────────────────────────────────────────
	async function seedAndClose() {
		const { sessionId } = (await newSession()).json()
		await app.inject({
			method: 'POST',
			url: '/events',
			payload: { sessionId, events: [measurementEvent(sessionId)] },
		})
		return app.inject({
			method: 'POST',
			url: '/internal/batches/close',
			headers: { authorization: `Bearer ${API_TOKEN}` },
			payload: { campaignId: 1 },
		})
	}

	it('closes a batch and returns a digest over its events', async () => {
		const res = await seedAndClose()
		expect(res.statusCode).toBe(201)
		expect(res.json().eventCount).toBe(1)
		expect(res.json().digest).toMatch(/^0x[0-9a-f]{64}$/)
	})

	it('refuses to close a batch with nothing pending', async () => {
		const res = await app.inject({
			method: 'POST',
			url: '/internal/batches/close',
			headers: { authorization: `Bearer ${API_TOKEN}` },
			payload: { campaignId: 1 },
		})
		expect(res.statusCode).toBe(409)
	})

	it('leaves the first batch untouched when a second is closed', async () => {
		const first = (await seedAndClose()).json()
		const { sessionId } = (await newSession()).json()
		await app.inject({
			method: 'POST',
			url: '/events',
			payload: { sessionId, events: [measurementEvent(sessionId)] },
		})
		const second = (
			await app.inject({
				method: 'POST',
				url: '/internal/batches/close',
				headers: { authorization: `Bearer ${API_TOKEN}` },
				payload: { campaignId: 1 },
			})
		).json()

		expect(second.batchId).not.toBe(first.batchId)
		const reread = await app.inject({
			method: 'GET',
			url: `/internal/batches/${first.batchId}`,
			headers: { authorization: `Bearer ${API_TOKEN}` },
		})
		expect(reread.json().batch.digest).toBe(first.digest)
		expect(reread.json().batch.eventCount).toBe(1)
	})

	it('returns a stable digest across reads, recomputable from the payload', async () => {
		const created = (await seedAndClose()).json()
		const a = await app.inject({
			method: 'GET',
			url: `/internal/batches/${created.batchId}`,
			headers: { authorization: `Bearer ${API_TOKEN}` },
		})
		const b = await app.inject({
			method: 'GET',
			url: `/internal/batches/${created.batchId}`,
			headers: { authorization: `Bearer ${API_TOKEN}` },
		})
		expect(a.json().batch.digest).toBe(b.json().batch.digest)
		// This is exactly the check the enclave performs before trusting the batch.
		expect(batchDigest(a.json().events)).toBe(created.digest)
	})

	it('reports only booleans about World eligibility, never a nullifier', async () => {
		const created = (await seedAndClose()).json()
		const res = await app.inject({
			method: 'GET',
			url: `/internal/batches/${created.batchId}`,
			headers: { authorization: `Bearer ${API_TOKEN}` },
		})
		const payload = res.json()
		expect(payload.sessions).toHaveLength(1)
		expect(payload.sessions[0]).toEqual({ sessionId: expect.any(String), worldEligible: false })
		expect(JSON.stringify(payload)).not.toContain('nullifier')
	})

	// ── Auth ────────────────────────────────────────────────────────────
	it('rejects an internal read with no bearer token', async () => {
		const res = await app.inject({ method: 'GET', url: '/internal/batches/anything' })
		expect(res.statusCode).toBe(403)
	})

	it('rejects an internal read with the wrong bearer token', async () => {
		const res = await app.inject({
			method: 'GET',
			url: '/internal/batches/anything',
			headers: { authorization: 'Bearer wrong' },
		})
		expect(res.statusCode).toBe(403)
	})

	it('404s an unknown batch for an authenticated caller', async () => {
		const res = await app.inject({
			method: 'GET',
			url: '/internal/batches/00000000-0000-0000-0000-000000000000',
			headers: { authorization: `Bearer ${API_TOKEN}` },
		})
		expect(res.statusCode).toBe(404)
	})

	// ── Summary ─────────────────────────────────────────────────────────
	it('summarises a campaign publicly without exposing events', async () => {
		await seedAndClose()
		const res = await app.inject({ method: 'GET', url: '/campaigns/1/summary' })
		expect(res.statusCode).toBe(200)
		const body = res.json()
		expect(body.qualifyingEvents).toBe(1)
		expect(body.distinctSessions).toBe(1)
		expect(body.unbatchedEvents).toBe(0)
		expect(body.batches).toHaveLength(1)
		expect(JSON.stringify(body)).not.toContain('sessionId')
	})
})
