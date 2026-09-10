import type { Address } from 'viem'
import { ADDRESSES, SEPOLIA_CHAIN_ID, LOCAL_CHAIN_ID } from '@proofads/shared'

/**
 * Every address the UI uses comes from here, and every value is injected at build time.
 * Nothing about protocol state is hardcoded — the ENS track explicitly rejects hardcoded values.
 *
 * Each variable is referenced literally as `process.env.NEXT_PUBLIC_…`: Next inlines only
 * static property accesses, so a `process.env[name]` helper would silently produce empty
 * strings in the browser bundle.
 */
export type WebConfig = {
	chainId: number
	rpcUrl: string
	apiUrl: string
	publisherName: string
	adInventoryRegistry: Address
	authorizationAdapter: Address
	market: Address
	settlementReceiver: Address
	usdc: Address
	publisherResolver: Address
	labelStore: Address
	rootRegistry: Address
	explorerBase: string
}

const ZERO = '0x0000000000000000000000000000000000000000' as Address

const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? String(LOCAL_CHAIN_ID))
const fallback = ADDRESSES[chainId]
const pick = (value: string | undefined, fromChain: Address | undefined): Address =>
	(value || fromChain || ZERO) as Address

export const config: WebConfig = {
	chainId,
	rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || 'http://127.0.0.1:8545',
	apiUrl: process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8787',
	publisherName: process.env.NEXT_PUBLIC_PUBLISHER_NAME || 'proofads-pub.eth',
	adInventoryRegistry: pick(process.env.NEXT_PUBLIC_AD_INVENTORY_REGISTRY, fallback?.adInventoryRegistry),
	authorizationAdapter: pick(process.env.NEXT_PUBLIC_AUTHORIZATION_ADAPTER, fallback?.authorizationAdapter),
	market: pick(process.env.NEXT_PUBLIC_MARKET, fallback?.market),
	settlementReceiver: pick(process.env.NEXT_PUBLIC_SETTLEMENT_RECEIVER, fallback?.settlementReceiver),
	usdc: pick(process.env.NEXT_PUBLIC_USDC, fallback?.usdc),
	publisherResolver: pick(process.env.NEXT_PUBLIC_PUBLISHER_RESOLVER, fallback?.publisherResolver),
	labelStore: pick(process.env.NEXT_PUBLIC_LABEL_STORE, fallback?.labelStore),
	rootRegistry: pick(process.env.NEXT_PUBLIC_ROOT_REGISTRY, fallback?.rootRegistry),
	explorerBase: chainId === SEPOLIA_CHAIN_ID ? 'https://sepolia.etherscan.io' : '',
}

/** Slot labels the demo publisher exposes. Configuration, never protocol state. */
export const SLOT_LABELS = (process.env.NEXT_PUBLIC_SLOTS || 'hero,sidebar')
	.split(',')
	.map((s) => s.trim())
	.filter(Boolean)

export function slotFullName(label: string): string {
	return `${label}.ads.${config.publisherName}`
}

export function txLink(hash: string): string {
	return config.explorerBase ? `${config.explorerBase}/tx/${hash}` : ''
}

export function addressLink(address: string): string {
	return config.explorerBase ? `${config.explorerBase}/address/${address}` : ''
}

/** True when the app has not been pointed at a deployment yet. */
export const isConfigured = config.market !== ZERO && config.adInventoryRegistry !== ZERO
