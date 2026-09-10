import { createPublicClient, http, type Address } from 'viem'
import { ProofAdsMarketAbi, CampaignStatus } from '@proofads/shared'

/** The on-chain campaign facts the collector needs. Everything else stays on chain. */
export type CampaignInfo = {
	campaignId: number
	status: CampaignStatus
	slotLabelhash: `0x${string}`
	creativeHash: `0x${string}`
	metric: number
	targetUnits: number
	verifiedUnits: number
	startTime: number
	deadline: number
}

/**
 * A seam, not an abstraction layer: the routes take this function so tests can run without a
 * chain, and production passes `viemCampaignReader`.
 */
export type CampaignReader = (campaignId: number) => Promise<CampaignInfo | null>

/** Latest block timestamp, in unix seconds. The collector's only clock. */
export type ChainClock = () => Promise<number>

export function viemChainClock(rpcUrl: string): ChainClock {
	const client = createPublicClient({ transport: http(rpcUrl) })
	return async () => Number((await client.getBlock()).timestamp)
}

export function viemCampaignReader(rpcUrl: string, market: Address): CampaignReader {
	const client = createPublicClient({ transport: http(rpcUrl) })
	return async (campaignId: number) => {
		const raw = (await client.readContract({
			address: market,
			abi: ProofAdsMarketAbi,
			functionName: 'getCampaign',
			args: [BigInt(campaignId)],
		})) as {
			labelhash: `0x${string}`
			creativeHash: `0x${string}`
			metric: number
			targetUnits: number
			verifiedUnits: number
			startTime: bigint
			deadline: bigint
			status: number
		}
		if (raw.status === CampaignStatus.NONE) return null
		return {
			campaignId,
			status: raw.status as CampaignStatus,
			slotLabelhash: raw.labelhash,
			creativeHash: raw.creativeHash.toLowerCase() as `0x${string}`,
			metric: raw.metric,
			targetUnits: Number(raw.targetUnits),
			verifiedUnits: Number(raw.verifiedUnits),
			startTime: Number(raw.startTime),
			deadline: Number(raw.deadline),
		}
	}
}
