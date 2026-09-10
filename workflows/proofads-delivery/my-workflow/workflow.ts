import {
	bytesToHex,
	cre,
	getNetwork,
	hexToBase64,
	ok,
	text,
	TxStatus,
	type TeeRuntime,
} from '@chainlink/cre-sdk'
import { encodeAbiParameters, keccak256, parseAbiParameters, toHex, type Address } from 'viem'
import { z } from 'zod'
import { ProofAdsMarket } from '../contracts/evm/ts/generated/ProofAdsMarket'
import { ProofAdsSettlementReceiver } from '../contracts/evm/ts/generated/ProofAdsSettlementReceiver'
import { batchWindow, canonicalBatchJson, qualify } from './qualify'
import type { BatchPayload } from './types'

// ─── Config ─────────────────────────────────────────────────────────────
export const configSchema = z.object({
	/** Cron expression, e.g. every 5 minutes. */
	schedule: z.string(),
	/** Public HTTPS base URL of the ProofAds measurement collector. */
	apiBaseUrl: z.string(),
	/** The closed batch to settle. */
	batchId: z.string(),
	/** The campaign the batch belongs to; cross-checked against the fetched payload. */
	campaignId: z.number(),
	/** Secret id declared in ../secrets.yaml and released by the Vault DON into the enclave. */
	secretId: z.string(),
	chainSelectorName: z.string(),
	receiverAddress: z.string(),
	/** The marketplace, read for the delivery total already settled on chain. */
	marketAddress: z.string(),
})
export type Config = z.infer<typeof configSchema>

/**
 * What crosses the enclave boundary, in both directions.
 *
 *   IN  (stays confidential):  the Vault DON secret `PROOFADS_API_TOKEN`; the HTTP request that
 *                              carries it; the HTTP response, which is the raw measurement
 *                              batch — every session id, every visibility ratio, every client
 *                              timestamp, every per-session liveness flag.
 *   OUT (public, signed):      campaignId, cumulativeVerifiedUnits, batchDigest, windowStart,
 *                              windowEnd. Five scalars. No session, no trace, no token.
 *
 * The enclave is not trusted to be honest about the data either: before qualifying anything it
 * recomputes the batch digest over the bytes it received and compares it to the digest the
 * collector published, so a collector that edits events after closing a batch is caught here.
 */
export const onSettle = (runtime: TeeRuntime<Config>): string => {
	const config = runtime.config

	// ── 1. Secret, released into the attested enclave ──────────────────
	const apiToken = runtime.getSecret({ id: config.secretId }).result().value

	// ── 2. Confidential HTTP from inside the enclave ───────────────────
	// The TeeRuntime overload of HTTPClient.sendRequest keeps both the request (which carries
	// the bearer token) and the response (the raw viewing data) confidential from node operators.
	const response = new cre.capabilities.HTTPClient()
		.sendRequest(runtime, {
			url: `${config.apiBaseUrl}/internal/batches/${config.batchId}`,
			method: 'GET',
			multiHeaders: { Authorization: { values: [`Bearer ${apiToken}`] } },
		})
		.result()

	if (!ok(response)) {
		throw new Error(`Confidential batch fetch failed with status: ${response.statusCode}`)
	}

	const payload = JSON.parse(text(response)) as BatchPayload

	// ── 3. Integrity checks on the confidential payload ────────────────
	if (payload.batch.campaignId !== config.campaignId) {
		throw new Error(
			`Batch belongs to campaign ${payload.batch.campaignId}, workflow is configured for ${config.campaignId}`,
		)
	}
	if (payload.campaign.campaignId !== config.campaignId) {
		throw new Error('Campaign metadata does not match the configured campaign')
	}
	const recomputed = keccak256(toHex(canonicalBatchJson(payload.events)))
	if (recomputed.toLowerCase() !== payload.batch.digest.toLowerCase()) {
		throw new Error('Batch digest mismatch — the batch was altered after it was closed')
	}
	if (payload.events.length !== payload.batch.eventCount) {
		throw new Error('Batch event count does not match the events returned')
	}

	// ── 4. The confidential computation ────────────────────────────────
	// Only the per-batch count is decided here. How much has already been paid is a public,
	// on-chain fact, read below — the measurement collector never gets to define it.
	const window = batchWindow(payload.events)

	// ── 5. Cross back to the DON ───────────────────────────────────────
	// Everything from here on is public and consensus-verified. Only the aggregate crosses.
	const donRuntime = runtime.usingTheDons()

	const network = getNetwork({
		chainFamily: 'evm',
		chainSelectorName: config.chainSelectorName,
		isTestnet: true,
	})
	if (!network) throw new Error(`Network not found: ${config.chainSelectorName}`)

	const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)
	const market = new ProofAdsMarket(evmClient, config.marketAddress as Address)
	const alreadySettled = market.verifiedUnitsOf(donRuntime, BigInt(config.campaignId))

	const result = qualify(payload, alreadySettled)

	// One log line, counts only. No session ids, no timestamps, no token, no raw body.
	// Remove even this before any production deployment.
	const rejected = Object.entries(result.rejections)
		.filter(([, count]) => count > 0)
		.map(([reason, count]) => `${reason}=${count}`)
		.join(' ')
	runtime.log(
		`Enclave qualification complete: batchEvents=${payload.events.length} newUnits=${result.newlyCountedUnits} alreadySettled=${alreadySettled} cumulative=${result.cumulativeVerifiedUnits}${rejected ? ` rejected[${rejected}]` : ''}`,
	)

	const reportPayload = encodeAbiParameters(
		parseAbiParameters(
			'uint256 campaignId, uint32 cumulativeVerifiedUnits, bytes32 batchDigest, uint64 windowStart, uint64 windowEnd',
		),
		[
			BigInt(config.campaignId),
			result.cumulativeVerifiedUnits,
			payload.batch.digest as `0x${string}`,
			BigInt(window.start),
			BigInt(window.end),
		],
	)

	const receiver = new ProofAdsSettlementReceiver(evmClient, config.receiverAddress as Address)

	const writeResult = receiver.writeReport(donRuntime, reportPayload)

	if (writeResult.txStatus !== TxStatus.SUCCESS) {
		throw new Error(`Settlement tx failed: ${writeResult.errorMessage || writeResult.txStatus}`)
	}
	if (
		writeResult.receiverContractExecutionStatus !== undefined &&
		writeResult.receiverContractExecutionStatus !== 0
	) {
		throw new Error(
			`Receiver execution failed: status ${writeResult.receiverContractExecutionStatus}`,
		)
	}

	const txHash = bytesToHex(writeResult.txHash || new Uint8Array(32))
	return `Settled campaign ${config.campaignId} at ${result.cumulativeVerifiedUnits} verified units — tx: ${txHash}`
}

// Keeps `hexToBase64` referenced for parity with the official template's report path, which
// uses it when calling `donRuntime.report({ encodedPayload })` directly instead of through a
// generated binding.
export const encodeForDirectReport = (payload: `0x${string}`) => hexToBase64(payload)

// ─── Workflow init ──────────────────────────────────────────────────────
export function initWorkflow(config: Config) {
	const cronTrigger = new cre.capabilities.CronCapability()

	return [
		// `handlerInTee`, not `handler`: the callback receives a TeeRuntime and runs inside an
		// AWS Nitro enclave. us-west-2 is currently the only registered TEE region.
		cre.handlerInTee(cronTrigger.trigger({ schedule: config.schedule }), onSettle, [
			{ tee: 'nitro', regions: ['us-west-2'] },
		]),
	]
}
