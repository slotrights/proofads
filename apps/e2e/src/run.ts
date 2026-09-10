/**
 * ProofAds end-to-end proof, on a local chain running the real ENSv2 contracts.
 *
 * Every step below is a real transaction or a real HTTP call. Nothing is stubbed, and no
 * success state is hardcoded: authorization comes from ENSv2 Enhanced Access Control, money
 * moves through a real ERC-20, and the delivery figure that unlocks the payout is produced by
 * the same `onSettle` confidential handler the Chainlink workflow deploys.
 */
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import {
	createPublicClient,
	createWalletClient,
	http,
	keccak256,
	type Address,
	type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import {
	AdInventoryRegistryAbi,
	ENSv2AuthorizationAdapterAbi,
	MockUSDCAbi,
	ProofAdsMarketAbi,
	MetricType,
	ROLE_SELL_SLOT,
	QUALIFYING_MS,
} from '@proofads/shared'
import { labelhash } from '@proofads/ens-client'
import { QualificationClock } from '@proofads/sdk'
import { check, checkTrue, expectRevert, info, step, summarize, usdc } from './util'

// ── Environment ───────────────────────────────────────────────────────
const ROOT = join(import.meta.dirname, '../../..')
const RPC_URL = process.env.LOCAL_RPC_URL ?? 'http://127.0.0.1:8545'
const API_URL = process.env.API_URL ?? 'http://127.0.0.1:8787'
const API_TOKEN = process.env.PROOFADS_API_TOKEN ?? 'local-dev-token'

const deployment = JSON.parse(
	readFileSync(join(ROOT, 'contracts/deployments/local.json'), 'utf8'),
) as Record<string, Address>

const key = (name: string): Hex => {
	const value = process.env[name]
	if (!value) throw new Error(`${name} is required`)
	return value as Hex
}

const publisher = privateKeyToAccount(key('PUBLISHER_PRIVATE_KEY'))
const agency = privateKeyToAccount(key('AGENCY_PRIVATE_KEY'))
const advertiserA = privateKeyToAccount(key('ADVERTISER_A_PRIVATE_KEY'))
const advertiserB = privateKeyToAccount(key('ADVERTISER_B_PRIVATE_KEY'))
const deployer = privateKeyToAccount(key('DEPLOYER_PRIVATE_KEY'))

const publicClient = createPublicClient({ chain: foundry, transport: http(RPC_URL) })
const wallet = (account: typeof publisher) =>
	createWalletClient({ account, chain: foundry, transport: http(RPC_URL) })

const REGISTRY = deployment.adInventoryRegistry as Address
const ADAPTER = deployment.authorizationAdapter as Address
const MARKET = deployment.market as Address
const RECEIVER = deployment.settlementReceiver as Address
const USDC = deployment.usdc as Address

const HERO = labelhash('hero')
const SIDEBAR = labelhash('sidebar')

const TARGET_UNITS = 2
const RESERVE = 100_000n // 0.10 USDC
const BID_A = 150_000n // 0.15 USDC
const BID_B = 200_000n // 0.20 USDC
const AUCTION_SECONDS = 180
const CAMPAIGN_SECONDS = 1200

// ── Helpers ───────────────────────────────────────────────────────────
async function send(account: typeof publisher, request: Parameters<typeof publicClient.simulateContract>[0]) {
	const { request: prepared } = await publicClient.simulateContract({ ...request, account } as never)
	const hash = await wallet(account).writeContract(prepared as never)
	const receipt = await publicClient.waitForTransactionReceipt({ hash })
	if (receipt.status !== 'success') throw new Error(`tx reverted: ${hash}`)
	return receipt
}

async function usdcBalance(address: Address): Promise<bigint> {
	return publicClient.readContract({
		address: USDC,
		abi: MockUSDCAbi,
		functionName: 'balanceOf',
		args: [address],
	}) as Promise<bigint>
}

async function isAuthorized(labelhashHex: Hex, account: Address): Promise<boolean> {
	return publicClient.readContract({
		address: ADAPTER,
		abi: ENSv2AuthorizationAdapterAbi,
		functionName: 'isAuthorizedSeller',
		args: [labelhashHex, account],
	}) as Promise<boolean>
}

async function increaseTime(seconds: number): Promise<void> {
	await fetch(RPC_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'evm_increaseTime', params: [seconds] }),
	})
	await fetch(RPC_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'evm_mine', params: [] }),
	})
}

async function api(path: string, init?: RequestInit): Promise<Response> {
	return fetch(`${API_URL}${path}`, init)
}

// ── The run ───────────────────────────────────────────────────────────
async function main() {
	console.log('\x1b[1mProofAds — end-to-end verification on a local ENSv2 chain\x1b[0m')
	info(`registry ${REGISTRY}`)
	info(`market   ${MARKET}`)
	info(`receiver ${RECEIVER}`)

	// ── 1. ENSv2 selling rights ────────────────────────────────────────
	step('1. ENSv2 Enhanced Access Control decides who may sell')

	check('hero owner is the publisher', await publicClient.readContract({
		address: REGISTRY, abi: AdInventoryRegistryAbi, functionName: 'getOwner', args: [BigInt(HERO)],
	}), publisher.address)

	check('agency may sell hero (before grant)', await isAuthorized(HERO, agency.address), false)

	await send(publisher, {
		address: REGISTRY,
		abi: AdInventoryRegistryAbi,
		functionName: 'grantRoles',
		args: [BigInt(HERO), ROLE_SELL_SLOT, agency.address],
	})
	check('agency may sell hero (after grant)', await isAuthorized(HERO, agency.address), true)
	check('agency may sell sidebar', await isAuthorized(SIDEBAR, agency.address), false)

	// The grant regenerated the ERC-1155 token id; the labelhash key did not move.
	const tokenId = await publicClient.readContract({
		address: REGISTRY, abi: AdInventoryRegistryAbi, functionName: 'getTokenId', args: [BigInt(HERO)],
	})
	info(`hero token id after grant: ${tokenId} (regenerated by ENSv2 — never used as a key)`)

	// ── 2. Listing is gated on live ENS state ──────────────────────────
	step('2. The marketplace reads authorization from ENS at call time')

	const probeAuctionEnd = BigInt((await now()) + AUCTION_SECONDS)
	await expectRevert('agency listing sidebar', () =>
		send(agency, {
			address: MARKET, abi: ProofAdsMarketAbi, functionName: 'createListing',
			args: [SIDEBAR, MetricType.VIEW_10_SECONDS, TARGET_UNITS, RESERVE,
				probeAuctionEnd, CAMPAIGN_SECONDS],
		}), 'SellerNotAuthorized')

	await send(publisher, {
		address: REGISTRY, abi: AdInventoryRegistryAbi, functionName: 'revokeRoles',
		args: [BigInt(HERO), ROLE_SELL_SLOT, agency.address],
	})
	check('agency may sell hero (after revoke)', await isAuthorized(HERO, agency.address), false)
	await expectRevert('agency listing hero while revoked', () =>
		send(agency, {
			address: MARKET, abi: ProofAdsMarketAbi, functionName: 'createListing',
			args: [HERO, MetricType.VIEW_10_SECONDS, TARGET_UNITS, RESERVE,
				probeAuctionEnd, CAMPAIGN_SECONDS],
		}), 'SellerNotAuthorized')

	await send(publisher, {
		address: REGISTRY, abi: AdInventoryRegistryAbi, functionName: 'grantRoles',
		args: [BigInt(HERO), ROLE_SELL_SLOT, agency.address],
	})
	check('agency may sell hero (after re-grant)', await isAuthorized(HERO, agency.address), true)

	const auctionEnd = BigInt((await now()) + AUCTION_SECONDS)
	await send(agency, {
		address: MARKET, abi: ProofAdsMarketAbi, functionName: 'createListing',
		args: [HERO, MetricType.VIEW_10_SECONDS, TARGET_UNITS, RESERVE, auctionEnd, CAMPAIGN_SECONDS],
	})
	const listingId = (await publicClient.readContract({
		address: MARKET, abi: ProofAdsMarketAbi, functionName: 'listingCount',
	})) as bigint
	check('listing created', listingId, 1n)

	const listing = (await publicClient.readContract({
		address: MARKET, abi: ProofAdsMarketAbi, functionName: 'getListing', args: [listingId],
	})) as { seller: Address; publisherAtCreation: Address }
	check('listing seller is the agency', listing.seller, agency.address)
	check('listing publisher came from ENS, not the caller', listing.publisherAtCreation, publisher.address)

	// ── 3. Bidding in real USDC ────────────────────────────────────────
	step('3. Two advertisers bid; escrow moves on chain')

	const creativeA = readFileSync(join(ROOT, 'apps/web/public/creatives/adv-a.png'))
	const creativeB = readFileSync(join(ROOT, 'apps/web/public/creatives/adv-b.png'))
	const hashA = keccak256(new Uint8Array(creativeA))
	const hashB = keccak256(new Uint8Array(creativeB))
	const uriA = `${process.env.WEB_URL ?? 'http://127.0.0.1:3000'}/creatives/adv-a.png`
	const uriB = `${process.env.WEB_URL ?? 'http://127.0.0.1:3000'}/creatives/adv-b.png`
	info(`creative A keccak256 = ${hashA}`)
	info(`creative B keccak256 = ${hashB}`)

	for (const [account, price, hash, uri] of [
		[advertiserA, BID_A, hashA, uriA],
		[advertiserB, BID_B, hashB, uriB],
	] as const) {
		const escrow = price * BigInt(TARGET_UNITS)
		await send(account, {
			address: USDC, abi: MockUSDCAbi, functionName: 'approve', args: [MARKET, escrow],
		})
		await send(account, {
			address: MARKET, abi: ProofAdsMarketAbi, functionName: 'placeBid',
			args: [listingId, price, hash, uri],
		})
	}
	check('market escrow after two bids',
		await usdcBalance(MARKET), (BID_A + BID_B) * BigInt(TARGET_UNITS))

	// ── 4. Finalization re-reads ENS ───────────────────────────────────
	step('4. Auction finalizes; the winner is the highest unit price')
	await expectRevert('finalizing before the auction ends', () =>
		send(deployer, { address: MARKET, abi: ProofAdsMarketAbi, functionName: 'finalizeAuction', args: [listingId] }),
		'AuctionNotEnded')

	await increaseTime(AUCTION_SECONDS + 5)
	await send(deployer, {
		address: MARKET, abi: ProofAdsMarketAbi, functionName: 'finalizeAuction', args: [listingId],
	})
	const campaignId = (await publicClient.readContract({
		address: MARKET, abi: ProofAdsMarketAbi, functionName: 'campaignCount',
	})) as bigint
	const campaign = (await publicClient.readContract({
		address: MARKET, abi: ProofAdsMarketAbi, functionName: 'getCampaign', args: [campaignId],
	})) as {
		advertiser: Address; publisher: Address; unitPrice: bigint; totalBudget: bigint
		creativeHash: Hex; creativeURI: string; targetUnits: number; deadline: bigint; status: number
	}
	check('campaign advertiser is the higher bidder', campaign.advertiser, advertiserB.address)
	check('campaign unit price', campaign.unitPrice, BID_B)
	check('campaign creative is the winner\'s', campaign.creativeHash, hashB)
	check('slot now has an active campaign',
		await publicClient.readContract({
			address: MARKET, abi: ProofAdsMarketAbi, functionName: 'activeCampaignForSlot', args: [HERO],
		}), campaignId)

	// ── 5. Loser refund ────────────────────────────────────────────────
	step('5. The losing advertiser withdraws in full')
	const beforeWithdraw = await usdcBalance(advertiserA.address)
	await send(advertiserA, {
		address: MARKET, abi: ProofAdsMarketAbi, functionName: 'withdrawBid', args: [listingId],
	})
	check('loser refunded', await usdcBalance(advertiserA.address) - beforeWithdraw,
		BID_A * BigInt(TARGET_UNITS))
	check('only the winner\'s budget remains escrowed',
		await usdcBalance(MARKET), BID_B * BigInt(TARGET_UNITS))

	// ── 6. Measurement ─────────────────────────────────────────────────
	step('6. A viewer watches the creative for ten qualifying seconds')

	const health = await api('/health')
	if (!health.ok) throw new Error(`measurement API not reachable at ${API_URL}`)

	const sessionRes = await api('/sessions', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			campaignId: Number(campaignId), slotLabel: 'hero', origin: 'https://sepolia-times.local',
		}),
	})
	check('session created', sessionRes.status, 201)
	const session = (await sessionRes.json()) as { sessionId: string; creativeHash: Hex }
	check('collector served the on-chain creative hash', session.creativeHash.toLowerCase(), hashB.toLowerCase())

	// The very measurement core the browser SDK runs, driven over a virtual ten seconds.
	// `clientTime` is deliberately this machine's wall clock: the collector overwrites the
	// authoritative timestamp with chain time, so a wrong browser clock must not matter.
	const events: unknown[] = []
	const clock = new QualificationClock({
		onEmit: (emission) => {
			events.push({
				eventId: `${session.sessionId}-${events.length}`,
				sessionId: session.sessionId,
				campaignId: Number(campaignId),
				eventType: emission.eventType,
				clientTime: Date.now() + emission.atMs,
				visibilityRatio: emission.visibilityRatio,
				visibleMs: emission.visibleMs,
				creativeHash: hashB.toLowerCase(),
				origin: 'https://sepolia-times.local',
				slotLabel: 'hero',
			})
		},
	})
	clock.start(0)
	clock.setIntersection(0.95, 0)
	for (let t = 1_000; t <= QUALIFYING_MS; t += 1_000) clock.tick(t)
	checkTrue('the measurement core qualified the view', clock.hasQualified)

	const uploadRes = await api('/events', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ sessionId: session.sessionId, events }),
	})
	const upload = (await uploadRes.json()) as { accepted: number; rejected: number }
	check('collector accepted every event', upload.rejected, 0)
	info(`${upload.accepted} raw measurement events stored`)

	// ── 7. Immutable batch ─────────────────────────────────────────────
	step('7. The batch is closed and becomes immutable')
	const closeRes = await api('/internal/batches/close', {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${API_TOKEN}` },
		body: JSON.stringify({ campaignId: Number(campaignId) }),
	})
	check('batch closed', closeRes.status, 201)
	const batch = (await closeRes.json()) as { batchId: string; digest: Hex; eventCount: number }
	info(`batch ${batch.batchId} digest ${batch.digest} over ${batch.eventCount} events`)

	const unauth = await api(`/internal/batches/${batch.batchId}`)
	check('batch is unreadable without the enclave secret', unauth.status, 403)

	// ── 8. Only the receiver may settle ────────────────────────────────
	step('8. Nobody but the Chainlink receiver can move settlement forward')
	await expectRevert('deployer calling applyDelivery directly', () =>
		send(deployer, {
			address: MARKET, abi: ProofAdsMarketAbi, functionName: 'applyDelivery',
			args: [campaignId, 2, batch.digest],
		}), 'NotSettlementReceiver')

	// ── 9. The confidential handler settles ────────────────────────────
	step('9. The confidential handler qualifies the batch and reports one aggregate')
	const publisherBefore = await usdcBalance(publisher.address)
	const harness = spawnSync('bun', ['run', 'run.ts'], {
		cwd: join(ROOT, 'workflows/proofads-delivery/local-harness'),
		encoding: 'utf8',
		env: {
			...process.env,
			API_BASE_URL: API_URL,
			BATCH_ID: batch.batchId,
			CAMPAIGN_ID: String(campaignId),
			RECEIVER_ADDRESS: RECEIVER,
			MARKET_ADDRESS: MARKET,
			RPC_URL,
			FORWARDER_PRIVATE_KEY: key('LOCAL_FORWARDER_PRIVATE_KEY'),
			SECRET_PROOFADS_API_TOKEN: API_TOKEN,
		},
	})
	console.log(harness.stdout?.trim().split('\n').map((l) => `   │ ${l}`).join('\n'))
	if (harness.status !== 0) {
		console.error(harness.stderr)
		throw new Error('confidential handler failed')
	}
	checkTrue('handler reported a settlement', harness.stdout.includes('Settled campaign'))
	checkTrue('handler never printed the enclave secret', !harness.stdout.includes(API_TOKEN))
	checkTrue('handler never printed a session id', !harness.stdout.includes(session.sessionId))

	const afterSettle = (await publicClient.readContract({
		address: MARKET, abi: ProofAdsMarketAbi, functionName: 'getCampaign', args: [campaignId],
	})) as { verifiedUnits: number; paidAmount: bigint; status: number }
	check('verified units on chain', afterSettle.verifiedUnits, 1)
	const publisherDelta = (await usdcBalance(publisher.address)) - publisherBefore
	check('publisher paid', publisherDelta, BID_B)
	info(`publisher received ${usdc(publisherDelta)} for ${afterSettle.verifiedUnits} of ${TARGET_UNITS} target units`)

	// Idempotence: replaying the identical report must pay nothing more.
	const beforeReplay = await usdcBalance(publisher.address)
	const replay = spawnSync('bun', ['run', 'run.ts'], {
		cwd: join(ROOT, 'workflows/proofads-delivery/local-harness'),
		encoding: 'utf8',
		env: {
			...process.env,
			API_BASE_URL: API_URL, BATCH_ID: batch.batchId, CAMPAIGN_ID: String(campaignId),
			RECEIVER_ADDRESS: RECEIVER, MARKET_ADDRESS: MARKET, RPC_URL,
			FORWARDER_PRIVATE_KEY: key('LOCAL_FORWARDER_PRIVATE_KEY'),
			SECRET_PROOFADS_API_TOKEN: API_TOKEN,
		},
	})
	check('replaying the same report is a no-op', await usdcBalance(publisher.address) - beforeReplay, 0n)
	if (replay.status !== 0) throw new Error('replay run failed')

	// ── 10. Close and refund ───────────────────────────────────────────
	step('10. After the deadline the undelivered half is refunded')
	const advertiserBefore = await usdcBalance(advertiserB.address)
	await increaseTime(CAMPAIGN_SECONDS + 5)
	await send(deployer, {
		address: MARKET, abi: ProofAdsMarketAbi, functionName: 'closeCampaign', args: [campaignId],
	})
	check('advertiser refunded the undelivered remainder',
		await usdcBalance(advertiserB.address) - advertiserBefore, BID_B)
	check('marketplace holds nothing afterwards', await usdcBalance(MARKET), 0n)
	check('slot is free again',
		await publicClient.readContract({
			address: MARKET, abi: ProofAdsMarketAbi, functionName: 'activeCampaignForSlot', args: [HERO],
		}), 0n)

	summarize()
}

async function now(): Promise<number> {
	const block = await publicClient.getBlock()
	return Number(block.timestamp)
}

main().catch((error) => {
	console.error('\n\x1b[31mE2E FAILED\x1b[0m')
	console.error(error)
	process.exit(1)
})
