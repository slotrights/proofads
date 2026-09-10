export type ApiConfig = {
	databaseUrl: string
	port: number
	host: string
	/** Bearer token the Chainlink enclave presents to reach `/internal/*`. */
	apiToken: string
	rpcUrl: string
	marketAddress: `0x${string}`
	chainId: number
	/** Seconds a viewer session stays usable. */
	sessionTtlSeconds: number
}

function required(name: string): string {
	const value = process.env[name]
	if (!value) throw new Error(`${name} is required`)
	return value
}

export function loadConfig(): ApiConfig {
	return {
		databaseUrl: required('DATABASE_URL'),
		port: Number(process.env.PORT ?? 8787),
		host: process.env.HOST ?? '0.0.0.0',
		apiToken: required('PROOFADS_API_TOKEN'),
		rpcUrl: required('RPC_URL'),
		marketAddress: required('MARKET_ADDRESS') as `0x${string}`,
		chainId: Number(process.env.CHAIN_ID ?? 31337),
		sessionTtlSeconds: Number(process.env.SESSION_TTL_SECONDS ?? 3600),
	}
}
