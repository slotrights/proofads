/**
 * Runs the real `onSettle` confidential handler against a live collector and a live chain,
 * using a synchronous stand-in for the CRE runtime. See README.md for exactly what this does
 * and does not stand in for.
 */
import { TxStatus } from '@chainlink/cre-sdk'
import type { TeeRuntime } from '@chainlink/cre-sdk'
import { onSettle, type Config } from '../my-workflow/workflow'

function env(name: string, fallback?: string): string {
	const value = process.env[name] ?? fallback
	if (!value) throw new Error(`${name} is required`)
	return value
}

const config: Config = {
	schedule: env('SCHEDULE', '0 */5 * * * *'),
	apiBaseUrl: env('API_BASE_URL'),
	batchId: env('BATCH_ID'),
	campaignId: Number(env('CAMPAIGN_ID')),
	secretId: env('SECRET_ID', 'PROOFADS_API_TOKEN'),
	chainSelectorName: env('CHAIN_SELECTOR_NAME', 'ethereum-testnet-sepolia'),
	receiverAddress: env('RECEIVER_ADDRESS'),
	marketAddress: env('MARKET_ADDRESS'),
}

const apiToken = env('SECRET_PROOFADS_API_TOKEN')
const rpcUrl = env('RPC_URL')
const forwarderKey = env('FORWARDER_PRIVATE_KEY')

/**
 * The CRE SDK deliberately types node builtins as `never` so workflows cannot reach for them,
 * so the harness shells out through Bun's synchronous spawn instead.
 */
function runSync(command: string[], label: string): string {
	const result = Bun.spawnSync(command, { stdout: 'pipe', stderr: 'pipe' })
	if (result.exitCode !== 0) {
		throw new Error(`${label} failed (exit ${result.exitCode}): ${result.stderr.toString()}`)
	}
	return result.stdout.toString()
}

/** Synchronous HTTP, because the CRE host environment calls capabilities synchronously. */
function httpGetSync(url: string, headers: string[]): { statusCode: number; body: Uint8Array } {
	const args = ['curl', '-sS', '-o', '-', '-w', '\n__STATUS__%{http_code}', url]
	for (const header of headers) args.push('-H', header)
	const out = runSync(args, 'curl')
	const marker = out.lastIndexOf('\n__STATUS__')
	const body = out.slice(0, marker)
	const statusCode = Number(out.slice(marker + '\n__STATUS__'.length).trim())
	return { statusCode, body: new TextEncoder().encode(body) }
}

let reportBytesHex: `0x${string}` | null = null
let settlementTxHash = ''

const donRuntime = {
	config,
	log: (message: string) => console.log(`[don] ${message}`),
	report: (input: { encodedPayload: string }) => {
		reportBytesHex = `0x${Buffer.from(input.encodedPayload, 'base64').toString('hex')}`
		return {
			result: () => ({ x_generatedCodeOnly_unwrap: () => ({ rawReport: new Uint8Array(0) }) }),
		}
	},
	callCapability: ({ method }: { method: string }) => {
		if (method === 'CallContract') {
			// The workflow reads the settled delivery total straight from the marketplace.
			const out = runSync(
				[
					'cast',
					'call',
					config.marketAddress,
					'verifiedUnitsOf(uint256)(uint32)',
					String(config.campaignId),
					'--rpc-url',
					rpcUrl,
				],
				'cast call',
			)
			const settled = BigInt(out.trim().split(/\s+/)[0] ?? '0')
			const hex = settled.toString(16).padStart(64, '0')
			return { result: () => ({ data: Uint8Array.from(Buffer.from(hex, 'hex')) }) }
		}
		if (method !== 'WriteReport') throw new Error(`Harness does not implement capability ${method}`)
		if (!reportBytesHex) throw new Error('WriteReport called before a report was prepared')
		// Deliver the signed report the way the Chainlink Forwarder does: call onReport on the
		// receiver from the forwarder address. Empty metadata, because this receiver is
		// configured to validate the forwarder only.
		const out = runSync(
			[
				'cast',
				'send',
				config.receiverAddress,
				'onReport(bytes,bytes)',
				'0x',
				reportBytesHex,
				'--rpc-url',
				rpcUrl,
				'--private-key',
				forwarderKey,
				'--json',
			],
			'cast send',
		)
		const receipt = JSON.parse(out) as { transactionHash: string; status: string }
		settlementTxHash = receipt.transactionHash
		const succeeded = receipt.status === '0x1' || receipt.status === 'success'
		return {
			result: () => ({
				txStatus: succeeded ? TxStatus.SUCCESS : TxStatus.REVERTED,
				txHash: Uint8Array.from(Buffer.from(receipt.transactionHash.slice(2), 'hex')),
				receiverContractExecutionStatus: succeeded ? 0 : 1,
			}),
		}
	},
}

const runtime = {
	config,
	getSecret: (request: { id?: string }) => ({ result: () => ({ id: request.id, value: apiToken }) }),
	callCapability: ({ payload }: { payload: Record<string, unknown> }) => {
		const url = String(payload.url)
		const multi = payload.multiHeaders as Record<string, { values?: string[] }> | undefined
		const headers: string[] = []
		for (const [name, value] of Object.entries(multi ?? {})) {
			for (const v of value.values ?? []) headers.push(`${name}: ${v}`)
		}
		return { result: () => httpGetSync(url, headers) }
	},
	log: (message: string) => console.log(`[enclave] ${message}`),
	usingTheDons: () => donRuntime,
} as unknown as TeeRuntime<Config>

const summary = onSettle(runtime)
console.log(summary)
console.log(JSON.stringify({ settlementTxHash, reportBytes: reportBytesHex }))
