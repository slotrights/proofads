import type { Address } from 'viem'

export const SEPOLIA_CHAIN_ID = 11155111
export const LOCAL_CHAIN_ID = 31337

export type ProofAdsAddresses = {
	/** ProofAds contracts. */
	adInventoryRegistry: Address
	authorizationAdapter: Address
	market: Address
	settlementReceiver: Address
	/** Settlement currency. */
	usdc: Address
	/** Chainlink KeystoneForwarder — the only address allowed to call `onReport`. */
	keystoneForwarder: Address
	/** ENSv2 pieces the UI reads. */
	labelStore: Address
	userRegistry: Address
	publisherResolver: Address
	ethRegistry: Address
	rootRegistry: Address
}

const ZERO = '0x0000000000000000000000000000000000000000' as const

/**
 * ENSv2 beta deployment on Ethereum Sepolia.
 *
 * Source: https://docs.ens.domains/learn/deployments (fetched 2026-09-09). The
 * `ensdomains/contracts-v2` repo's `contracts/deployments/sepolia/*.json` disagrees with the
 * docs page for several of these; Verify with `cast code <addr>` before use.
 */
export const ENSV2_SEPOLIA = {
	verifiableFactory: '0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef',
	userRegistryImpl: '0x624a25d67b59d587752ebec8dded8827dae52050',
	permissionedResolverImpl: '0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e',
	labelStore: '0x532cd0cc4ac0793d838f71a67d29b2d790d18777',
	rootRegistry: '0x8115186e8f2e0b0281e86ab91f0f48ba90364354',
	ethRegistry: '0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2',
	ethRegistrar: '0xa88553f454b77203b0d036a05c894d555eaaa2cc',
	universalResolverV2: '0x4a1817d13e9cf196f471725176355c1234b63c70',
	mockUsdc: '0x768f42455a2d082e23ceef7d51e5787c82d67a39',
	publicResolverV2: '0xe7b9a25607e02da8145e4eb1836ca539e53f11f7',
} as const satisfies Record<string, Address>

/** Circle's official testnet USDC on Ethereum Sepolia, 6 decimals. Not ENS's MockUSDC. */
export const CIRCLE_USDC_SEPOLIA = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as const

/** Chainlink KeystoneForwarder on Ethereum Sepolia (per the CRE starter templates). */
export const KEYSTONE_FORWARDER_SEPOLIA = '0x15fc6ae953e024d975e77382eeec56a9101f9f88' as const

/** USDC has 6 decimals on every network ProofAds targets. */
export const USDC_DECIMALS = 6

/**
 * Filled in by `pnpm deploy:sepolia`, which rewrites this file's `sepolia` entry from
 * `contracts/deployments/sepolia.json`. Zeroes mean "not deployed yet".
 */
export const ADDRESSES: Record<number, ProofAdsAddresses> = {
	[SEPOLIA_CHAIN_ID]: {
		adInventoryRegistry: ZERO,
		authorizationAdapter: ZERO,
		market: ZERO,
		settlementReceiver: ZERO,
		usdc: CIRCLE_USDC_SEPOLIA,
		keystoneForwarder: KEYSTONE_FORWARDER_SEPOLIA,
		labelStore: ENSV2_SEPOLIA.labelStore,
		userRegistry: ZERO,
		publisherResolver: ZERO,
		ethRegistry: ENSV2_SEPOLIA.ethRegistry,
		rootRegistry: ENSV2_SEPOLIA.rootRegistry,
	},
}

/** Local Anvil addresses are read at runtime from `contracts/deployments/local.json`. */
export function isPlaceholder(address: Address): boolean {
	return address.toLowerCase() === ZERO
}
