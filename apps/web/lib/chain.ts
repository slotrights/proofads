'use client'

import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { chain } from './wagmi'
import type { Address, Hex } from 'viem'
import {
	AdInventoryRegistryAbi,
	ENSv2AuthorizationAdapterAbi,
	MockUSDCAbi,
	ProofAdsMarketAbi,
	PermissionedResolverAbi,
	ListingStatus,
} from '@proofads/shared'
import { labelhash, namehash } from '@proofads/ens-client'
import { config, SLOT_LABELS, slotFullName } from './config'

export type Slot = {
	label: string
	fullName: string
	labelhash: Hex
	owner: Address
	expiry: bigint
	tokenId: bigint
	placement: string
	domain: string
}

export type Listing = {
	id: bigint
	labelhash: Hex
	seller: Address
	publisherAtCreation: Address
	metric: number
	targetUnits: number
	reserveUnitPrice: bigint
	auctionEnd: bigint
	campaignDuration: number
	status: number
	campaignId: bigint
}

export type Bid = {
	bidder: Address
	unitPrice: bigint
	escrow: bigint
	creativeHash: Hex
	creativeURI: string
	withdrawn: boolean
}

export type Campaign = {
	listingId: bigint
	labelhash: Hex
	publisher: Address
	seller: Address
	advertiser: Address
	metric: number
	unitPrice: bigint
	targetUnits: number
	verifiedUnits: number
	totalBudget: bigint
	paidAmount: bigint
	startTime: bigint
	deadline: bigint
	creativeHash: Hex
	creativeURI: string
	status: number
}

/** Every ad slot in the inventory, read from chain (never a hardcoded list of state). */
export function useSlots() {
	const client = usePublicClient({ chainId: chain.id })
	return useQuery({
		queryKey: ['slots', config.adInventoryRegistry],
		enabled: Boolean(client && config.adInventoryRegistry),
		queryFn: async (): Promise<Slot[]> => {
			if (!client) return []
			return Promise.all(
				SLOT_LABELS.map(async (label): Promise<Slot> => {
					const id = BigInt(labelhash(label))
					const [owner, expiry, tokenId] = await Promise.all([
						client.readContract({
							address: config.adInventoryRegistry, abi: AdInventoryRegistryAbi,
							functionName: 'getOwner', args: [id],
						}) as Promise<Address>,
						client.readContract({
							address: config.adInventoryRegistry, abi: AdInventoryRegistryAbi,
							functionName: 'getExpiry', args: [id],
						}) as Promise<bigint>,
						client.readContract({
							address: config.adInventoryRegistry, abi: AdInventoryRegistryAbi,
							functionName: 'getTokenId', args: [id],
						}) as Promise<bigint>,
					])
					const fullName = slotFullName(label)
					const text = async (key: string) => {
						if (!config.publisherResolver) return ''
						try {
							return (await client.readContract({
								address: config.publisherResolver, abi: PermissionedResolverAbi,
								functionName: 'text', args: [namehash(fullName), key],
							})) as string
						} catch {
							return ''
						}
					}
					const [placement, domain] = await Promise.all([
						text('com.proofads.placement'),
						text('com.proofads.domain'),
					])
					return { label, fullName, labelhash: labelhash(label), owner, expiry, tokenId, placement, domain }
				}),
			)
		},
	})
}

/** Live ENS authorization for one (slot, account) pair. Never cached across a mutation. */
export function useIsAuthorizedSeller(slotLabel: string | undefined, account: Address | undefined) {
	const client = usePublicClient({ chainId: chain.id })
	return useQuery({
		queryKey: ['authorized', slotLabel, account],
		enabled: Boolean(client && slotLabel && account && config.authorizationAdapter),
		queryFn: async (): Promise<boolean> => {
			if (!client || !slotLabel || !account) return false
			return client.readContract({
				address: config.authorizationAdapter, abi: ENSv2AuthorizationAdapterAbi,
				functionName: 'isAuthorizedSeller', args: [labelhash(slotLabel), account],
			}) as Promise<boolean>
		},
	})
}

export function useListings() {
	const client = usePublicClient({ chainId: chain.id })
	return useQuery({
		queryKey: ['listings', config.market],
		enabled: Boolean(client && config.market),
		queryFn: async (): Promise<Listing[]> => {
			if (!client) return []
			const count = (await client.readContract({
				address: config.market, abi: ProofAdsMarketAbi, functionName: 'listingCount',
			})) as bigint
			const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1))
			return Promise.all(
				ids.map(async (id) => {
					const raw = (await client.readContract({
						address: config.market, abi: ProofAdsMarketAbi, functionName: 'getListing', args: [id],
					})) as Omit<Listing, 'id'>
					return { ...raw, id }
				}),
			)
		},
	})
}

export function useBids(listingId: bigint | undefined) {
	const client = usePublicClient({ chainId: chain.id })
	return useQuery({
		queryKey: ['bids', listingId?.toString()],
		enabled: Boolean(client && listingId),
		queryFn: async (): Promise<Bid[]> => {
			if (!client || !listingId) return []
			return client.readContract({
				address: config.market, abi: ProofAdsMarketAbi, functionName: 'getBids', args: [listingId],
			}) as Promise<Bid[]>
		},
	})
}

export function useCampaign(campaignId: bigint | undefined) {
	const client = usePublicClient({ chainId: chain.id })
	return useQuery({
		queryKey: ['campaign', campaignId?.toString()],
		enabled: Boolean(client && campaignId && campaignId > 0n),
		queryFn: async (): Promise<Campaign | null> => {
			if (!client || !campaignId) return null
			return client.readContract({
				address: config.market, abi: ProofAdsMarketAbi, functionName: 'getCampaign', args: [campaignId],
			}) as Promise<Campaign>
		},
	})
}

export function useUsdcBalance(address: Address | undefined) {
	const client = usePublicClient({ chainId: chain.id })
	return useQuery({
		queryKey: ['usdc', address],
		enabled: Boolean(client && address && config.usdc),
		queryFn: async (): Promise<bigint> => {
			if (!client || !address) return 0n
			return client.readContract({
				address: config.usdc, abi: MockUSDCAbi, functionName: 'balanceOf', args: [address],
			}) as Promise<bigint>
		},
	})
}

export function useChainTime() {
	const client = usePublicClient({ chainId: chain.id })
	return useQuery({
		queryKey: ['chain-time'],
		enabled: Boolean(client),
		refetchInterval: 3_000,
		queryFn: async (): Promise<bigint> => {
			if (!client) return 0n
			return (await client.getBlock()).timestamp
		},
	})
}

export const isOpen = (listing: Listing) => listing.status === ListingStatus.OPEN
