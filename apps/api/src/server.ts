import { loadConfig } from './config'
import { migrate } from './db/migrate'
import { viemCampaignReader, viemChainClock } from './chain'
import { buildApp } from './app'

const config = loadConfig()
await migrate(config.databaseUrl)

const app = await buildApp({
	databaseUrl: config.databaseUrl,
	apiToken: config.apiToken,
	readCampaign: viemCampaignReader(config.rpcUrl, config.marketAddress),
	chainNow: viemChainClock(config.rpcUrl),
	sessionTtlSeconds: config.sessionTtlSeconds,
	logger: true,
})

await app.listen({ port: config.port, host: config.host })
console.log(`ProofAds measurement API listening on ${config.host}:${config.port}`)
