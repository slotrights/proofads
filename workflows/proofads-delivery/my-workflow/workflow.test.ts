import { describe, expect, test } from 'bun:test'
import { decodeAbiParameters, parseAbiParameters } from 'viem'
import { TxStatus, type TeeRuntime } from '@chainlink/cre-sdk'
import { initWorkflow, onSettle, type Config } from './workflow'
import { CREATIVE, event, payload } from './fixtures'
import type { BatchPayload } from './types'

const API_TOKEN = 'super-secret-collector-token'

const config = (overrides: Partial<Config> = {}): Config => ({
	schedule: '0 */5 * * * *',
	apiBaseUrl: 'https://api.proofads.example',
	batchId: 'batch-1',
	campaignId: 1,
	secretId: 'PROOFADS_API_TOKEN',
	chainSelectorName: 'ethereum-testnet-sepolia',
	receiverAddress: '0x000000000000000000000000000000000000dEaD',
	marketAddress: '0x000000000000000000000000000000000000bEEF',
	...overrides,
})

/**
 * The public test surface does not ship a TEE runtime factory (`newTestRuntime` returns a DON
 * `Runtime`), so — exactly as the official hello-confidential template does — we stand up the
 * slice of `TeeRuntime` the handler actually uses, plus the EVM capability the write path goes
 * through. Everything the handler passes to `usingTheDons()` is captured so a test can assert
 * what does and does not leave the enclave.
 */
function makeFakeTeeRuntime(options: {
	statusCode?: number
	body?: BatchPayload | string
	cfg?: Config
	txStatus?: number
	receiverStatus?: number
	/** Delivery already settled on chain, as the marketplace would report it. */
	alreadySettled?: number
}) {
	const capturedHeaders: string[] = []
	const capturedUrls: string[] = []
	const donCalls: { capabilityId: string; payload: unknown }[] = []
	const reports: unknown[] = []
	const logs: string[] = []

	const body =
		typeof options.body === 'string' ? options.body : JSON.stringify(options.body ?? payload([event()]))

	const donRuntime = {
		config: options.cfg ?? config(),
		log: (m: string) => logs.push(m),
		report: (input: unknown) => {
			reports.push(input)
			// The real Runtime returns a wrapped protobuf Report; the EVM capability unwraps it
			// before building the WriteReport payload, so the fake must offer the same hook.
			return {
				result: () => ({
					x_generatedCodeOnly_unwrap: () => ({ rawReport: new Uint8Array(0) }),
				}),
			}
		},
		callCapability: ({
			capabilityId,
			method,
			payload: p,
		}: { capabilityId: string; method: string; payload: unknown }) => {
			donCalls.push({ capabilityId, payload: p })
			if (method === 'CallContract') {
				// abi-encoded uint32 return of `verifiedUnitsOf`.
				const settled = options.alreadySettled ?? 0
				const hex = settled.toString(16).padStart(64, '0')
				return {
					result: () => ({ data: Uint8Array.from(Buffer.from(hex, 'hex')) }),
				}
			}
			return {
				result: () => ({
					txStatus: options.txStatus ?? TxStatus.SUCCESS,
					txHash: new Uint8Array(32).fill(7),
					receiverContractExecutionStatus: options.receiverStatus ?? 0,
				}),
			}
		},
	}

	const runtime = {
		config: options.cfg ?? config(),
		getSecret: (request: { id?: string }) => ({
			result: () => ({ id: request.id, value: API_TOKEN }),
		}),
		callCapability: ({ payload: p }: { payload: Record<string, unknown> }) => {
			const multiHeaders = p.multiHeaders as Record<string, { values?: string[] }> | undefined
			const auth = multiHeaders?.Authorization
			capturedHeaders.push(...(auth?.values ?? []))
			if (typeof p.url === 'string') capturedUrls.push(p.url)
			return {
				result: () => ({
					statusCode: options.statusCode ?? 200,
					body: new TextEncoder().encode(body),
				}),
			}
		},
		log: (message: string) => logs.push(message),
		usingTheDons: () => donRuntime,
	}

	return {
		runtime: runtime as unknown as TeeRuntime<Config>,
		capturedHeaders,
		capturedUrls,
		donCalls,
		reports,
		logs,
	}
}

/** Pull the ABI payload back out of whatever the handler asked the DON to sign. */
function decodeReport(reports: unknown[]) {
	const request = reports[0] as { encodedPayload?: string } | undefined
	expect(request).toBeDefined()
	return request
}

describe('onSettle — the confidential handler', () => {
	test('fetches the batch with the enclave-released secret', () => {
		const { runtime, capturedHeaders, capturedUrls } = makeFakeTeeRuntime({})
		onSettle(runtime)
		expect(capturedHeaders).toEqual([`Bearer ${API_TOKEN}`])
		expect(capturedUrls[0]).toBe('https://api.proofads.example/internal/batches/batch-1')
	})

	test('returns a settlement summary with the tx hash', () => {
		const { runtime } = makeFakeTeeRuntime({})
		expect(onSettle(runtime)).toContain('Settled campaign 1 at 1 verified units')
	})

	test('crosses to the DON exactly once, to sign a report', () => {
		const { runtime, reports } = makeFakeTeeRuntime({})
		onSettle(runtime)
		expect(reports).toHaveLength(1)
	})

	test('the report carries only the five public scalars', () => {
		const events = [event({ sessionId: 'a' }), event({ sessionId: 'b' })]
		const built = payload(events, { targetUnits: 5 })
		const { runtime, reports } = makeFakeTeeRuntime({ body: built })
		onSettle(runtime)

		const request = decodeReport(reports) as { encodedPayload?: unknown }
		const serialized = JSON.stringify(request)
		// Nothing confidential may appear anywhere in what we hand the DON.
		expect(serialized).not.toContain(API_TOKEN)
		expect(serialized).not.toContain('sess-')
		expect(serialized).not.toContain('sessionId')
		expect(serialized).not.toContain('visibilityRatio')
		expect(serialized).not.toContain('origin')
	})

	test('the encoded report decodes to the qualified aggregate', () => {
		// Reach into the same encoding the handler performs, by decoding the calldata that the
		// binding built for `onReport`.
		const events = [event({ sessionId: 'a' }), event({ sessionId: 'b' }), event({ sessionId: 'a' })]
		const built = payload(events, { targetUnits: 5 })
		const { runtime, reports } = makeFakeTeeRuntime({ body: built })
		onSettle(runtime)

		const request = reports[0] as { encodedPayload?: string; encoderName?: string }
		const raw = request.encodedPayload
		expect(typeof raw).toBe('string')
		expect(request.encoderName).toBe('evm')
		// The report payload is the abi-encoded aggregate itself; the Forwarder is what wraps it
		// into `onReport(metadata, report)` when it calls the receiver.
		const reportBytes = ('0x' + Buffer.from(raw as string, 'base64').toString('hex')) as `0x${string}`
		const [campaignId, cumulative, digest] = decodeAbiParameters(
			parseAbiParameters(
				'uint256 campaignId, uint32 cumulativeVerifiedUnits, bytes32 batchDigest, uint64 windowStart, uint64 windowEnd',
			),
			reportBytes,
		)
		expect(campaignId).toBe(1n)
		expect(cumulative).toBe(2) // three events, two distinct sessions
		expect(digest).toBe(built.batch.digest as `0x${string}`)
	})

	test('refuses a batch whose digest does not match its events', () => {
		const built = payload([event()], { digest: '0x' + '11'.repeat(32) })
		const { runtime, reports } = makeFakeTeeRuntime({ body: built })
		expect(() => onSettle(runtime)).toThrow('Batch digest mismatch')
		expect(reports).toHaveLength(0)
	})

	test('refuses a batch belonging to a different campaign', () => {
		const built = payload([event({ campaignId: 9 })], { campaignId: 9 })
		const { runtime, reports } = makeFakeTeeRuntime({ body: built })
		expect(() => onSettle(runtime)).toThrow('campaign')
		expect(reports).toHaveLength(0)
	})

	test('refuses a batch whose event count was tampered with', () => {
		const built = payload([event()])
		built.batch.eventCount = 5
		const { runtime, reports } = makeFakeTeeRuntime({ body: built })
		expect(() => onSettle(runtime)).toThrow('event count')
		expect(reports).toHaveLength(0)
	})

	test('throws on a non-2xx collector response and never reaches the DON', () => {
		const { runtime, reports } = makeFakeTeeRuntime({ statusCode: 403 })
		expect(() => onSettle(runtime)).toThrow('status: 403')
		expect(reports).toHaveLength(0)
	})

	test('throws when the settlement transaction fails', () => {
		const { runtime } = makeFakeTeeRuntime({ txStatus: TxStatus.REVERTED })
		expect(() => onSettle(runtime)).toThrow('Settlement tx failed')
	})

	test('throws when the receiver contract reverts', () => {
		const { runtime } = makeFakeTeeRuntime({ receiverStatus: 1 })
		expect(() => onSettle(runtime)).toThrow('Receiver execution failed')
	})

	test('never logs the secret, a session id, or the raw response body', () => {
		const built = payload([event({ sessionId: 'very-identifying-session' })])
		const { runtime, logs } = makeFakeTeeRuntime({ body: built })
		onSettle(runtime)
		expect(logs.length).toBeGreaterThan(0)
		for (const line of logs) {
			expect(line).not.toContain(API_TOKEN)
			expect(line).not.toContain('very-identifying-session')
			expect(line).not.toContain(CREATIVE)
			expect(line).not.toContain('visibilityRatio')
		}
	})

	test('reports the on-chain settled total when a batch qualifies nothing', () => {
		const built = payload([event({ visibleMs: 1_000 })], { targetUnits: 3 })
		const { runtime } = makeFakeTeeRuntime({ body: built, alreadySettled: 1 })
		expect(onSettle(runtime)).toContain('at 1 verified units')
	})

	test('adds this batch to whatever the marketplace says is already settled', () => {
		const built = payload([event({ sessionId: 'a' }), event({ sessionId: 'b' })], { targetUnits: 9 })
		const { runtime } = makeFakeTeeRuntime({ body: built, alreadySettled: 3 })
		expect(onSettle(runtime)).toContain('at 5 verified units')
	})

	test('ignores the collector\'s claim about what has already been paid', () => {
		// The payload says 7 have been settled; the chain says 1. The chain wins.
		const built = payload([event()], { previouslySettledUnits: 7, targetUnits: 9 })
		const { runtime } = makeFakeTeeRuntime({ body: built, alreadySettled: 1 })
		expect(onSettle(runtime)).toContain('at 2 verified units')
	})

	test('still caps the reported total at the campaign target', () => {
		const built = payload([event(), event(), event()], { targetUnits: 2 })
		const { runtime } = makeFakeTeeRuntime({ body: built, alreadySettled: 1 })
		expect(onSettle(runtime)).toContain('at 2 verified units')
	})
})

describe('initWorkflow', () => {
	test('registers a TEE handler, not an ordinary DON handler', () => {
		const handlers = initWorkflow(config())
		expect(handlers).toHaveLength(1)
		expect(handlers[0]!.fn).toBe(onSettle)
		// handlerInTee attaches enclave requirements; cre.handler does not.
		expect(handlers[0]!.requirements).toBeDefined()
	})
})
