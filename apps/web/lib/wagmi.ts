'use client'

import { createConfig, http } from 'wagmi'
import { sepolia, foundry } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'
import { config as appConfig } from './config'
import { SEPOLIA_CHAIN_ID } from '@proofads/shared'

/**
 * Injected wallets only.
 *
 * ADR-011a: the plan called for RainbowKit, which needs a WalletConnect project id and pulls a
 * large dependency tree. The demo is driven from a browser wallet on one machine, so the
 * injected connector is the whole requirement. Swapping RainbowKit back in later touches only
 * this file.
 */
export const chain = appConfig.chainId === SEPOLIA_CHAIN_ID ? sepolia : foundry

// The configured chain comes first: hooks called before a wallet connects fall back to
// `chains[0]`, and reading the wrong chain there is a silent, very confusing failure.
export const wagmiConfig = createConfig({
	chains: appConfig.chainId === SEPOLIA_CHAIN_ID ? [sepolia, foundry] : [foundry, sepolia],
	connectors: [injected()],
	transports: {
		[sepolia.id]: http(appConfig.chainId === SEPOLIA_CHAIN_ID ? appConfig.rpcUrl : undefined),
		[foundry.id]: http(appConfig.chainId === SEPOLIA_CHAIN_ID ? undefined : appConfig.rpcUrl),
	},
	ssr: true,
})

declare module 'wagmi' {
	interface Register {
		config: typeof wagmiConfig
	}
}
