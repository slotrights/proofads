/**
 * Puts an active campaign on the hero slot so a human (or a browser test) can watch the demo
 * publisher page render a real, hash-verified creative.
 *
 * Same path as the full E2E, minus the settlement steps: grant -> list -> two bids -> finalize.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPublicClient, createWalletClient, http, keccak256, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import { AdInventoryRegistryAbi, MockUSDCAbi, ProofAdsMarketAbi, MetricType, ROLE_SELL_SLOT } from '@proofads/shared'
import { labelhash } from '@proofads/ens-client'

const ROOT = join(import.meta.dirname, '../../..')
const RPC_URL = process.env.LOCAL_RPC_URL ?? 'http://127.0.0.1:8545'
const WEB_URL = process.env.WEB_URL ?? 'http://127.0.0.1:3000'
const deployment = JSON.parse(readFileSync(join(ROOT, 'contracts/deployments/local.json'), 'utf8')) as Record<string, Address>

const k = (n: string) => (process.env[n] as Hex) ?? (() => { throw new Error(`${n} required`) })()
const publisher = privateKeyToAccount(k('PUBLISHER_PRIVATE_KEY'))
const agency = privateKeyToAccount(k('AGENCY_PRIVATE_KEY'))
const advertiserA = privateKeyToAccount(k('ADVERTISER_A_PRIVATE_KEY'))
const advertiserB = privateKeyToAccount(k('ADVERTISER_B_PRIVATE_KEY'))
const deployer = privateKeyToAccount(k('DEPLOYER_PRIVATE_KEY'))

const pc = createPublicClient({ chain: foundry, transport: http(RPC_URL) })
const wc = (a: typeof publisher) => createWalletClient({ account: a, chain: foundry, transport: http(RPC_URL) })

async function send(account: typeof publisher, req: Parameters<typeof pc.simulateContract>[0]) {
	const { request } = await pc.simulateContract({ ...req, account } as never)
	const hash = await wc(account).writeContract(request as never)
	const receipt = await pc.waitForTransactionReceipt({ hash })
	if (receipt.status !== 'success') throw new Error(`reverted ${hash}`)
	return hash
}

async function rpc(method: string, params: unknown[]) {
	await fetch(RPC_URL, {
		method: 'POST', headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
	})
}

const HERO = labelhash('hero')
const TARGET = 2
const DURATION = Number(process.env.CAMPAIGN_SECONDS ?? 3600)

async function main() {
	// A slot can hold only one active campaign. If a previous demo left one behind, retire it
	// first: warp past its deadline on the local chain and close it, refunding the advertiser.
	const existing = (await pc.readContract({
		address: deployment.market as Address, abi: ProofAdsMarketAbi,
		functionName: 'activeCampaignForSlot', args: [HERO],
	})) as bigint
	if (existing > 0n) {
		const c = (await pc.readContract({
			address: deployment.market as Address, abi: ProofAdsMarketAbi,
			functionName: 'getCampaign', args: [existing],
		})) as { deadline: bigint }
		const nowTs = (await pc.getBlock()).timestamp
		if (nowTs < c.deadline) {
			await rpc('evm_increaseTime', [Number(c.deadline - nowTs) + 5])
			await rpc('evm_mine', [])
		}
		await send(deployer, {
			address: deployment.market as Address, abi: ProofAdsMarketAbi,
			functionName: 'closeCampaign', args: [existing],
		})
		console.error(`retired campaign ${existing}`)
	}

	const authorized = (await pc.readContract({
		address: deployment.adInventoryRegistry as Address, abi: AdInventoryRegistryAbi,
		functionName: 'isAuthorizedSeller', args: [BigInt(HERO), agency.address],
	})) as boolean
	if (!authorized) {
		await send(publisher, {
			address: deployment.adInventoryRegistry as Address, abi: AdInventoryRegistryAbi,
			functionName: 'grantRoles', args: [BigInt(HERO), ROLE_SELL_SLOT, agency.address],
		})
	}

	const nowSeconds = Number((await pc.getBlock()).timestamp)
	await send(agency, {
		address: deployment.market as Address, abi: ProofAdsMarketAbi, functionName: 'createListing',
		args: [HERO, MetricType.VIEW_10_SECONDS, TARGET, 100_000n, BigInt(nowSeconds + 120), DURATION],
	})
	const listingId = (await pc.readContract({
		address: deployment.market as Address, abi: ProofAdsMarketAbi, functionName: 'listingCount',
	})) as bigint

	for (const [account, price, file] of [
		[advertiserA, 150_000n, 'adv-a.png'],
		[advertiserB, 200_000n, 'adv-b.png'],
	] as const) {
		const bytes = new Uint8Array(readFileSync(join(ROOT, `apps/web/public/creatives/${file}`)))
		const escrow = price * BigInt(TARGET)
		await send(account, {
			address: deployment.usdc as Address, abi: MockUSDCAbi, functionName: 'approve',
			args: [deployment.market as Address, escrow],
		})
		await send(account, {
			address: deployment.market as Address, abi: ProofAdsMarketAbi, functionName: 'placeBid',
			args: [listingId, price, keccak256(bytes), `${WEB_URL}/creatives/${file}`],
		})
	}

	await rpc('evm_increaseTime', [130])
	await rpc('evm_mine', [])
	await send(deployer, {
		address: deployment.market as Address, abi: ProofAdsMarketAbi, functionName: 'finalizeAuction',
		args: [listingId],
	})
	const campaignId = (await pc.readContract({
		address: deployment.market as Address, abi: ProofAdsMarketAbi, functionName: 'campaignCount',
	})) as bigint
	console.log(JSON.stringify({ listingId: listingId.toString(), campaignId: campaignId.toString() }))
}

main().catch((e) => { console.error(e); process.exit(1) })
