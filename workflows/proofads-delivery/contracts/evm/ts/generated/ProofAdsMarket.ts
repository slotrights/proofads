/**
 * Hand-written twin of the `cre generate-bindings evm` output for the read side of
 * `ProofAdsMarket`, following the shape of the generated `ReactorConsumer.ts` in the official CRE
 * starter templates (`encodeFunctionData` -> `client.callContract` -> `decodeFunctionResult`).
 */
import {
	encodeCallMsg,
	EVMClient,
	LAST_FINALIZED_BLOCK_NUMBER,
	bytesToHex,
	type Runtime,
} from '@chainlink/cre-sdk'
import { decodeFunctionResult, encodeFunctionData, zeroAddress } from 'viem'
import type { Address } from 'viem'
import { ProofAdsMarketABI } from '../../../abi/ProofAdsMarket'

export class ProofAdsMarket {
	constructor(
		private readonly client: EVMClient,
		public readonly address: Address,
	) {}

	/** Cumulative delivery already settled on chain for this campaign. */
	verifiedUnitsOf(runtime: Runtime<unknown>, campaignId: bigint): number {
		const callData = encodeFunctionData({
			abi: ProofAdsMarketABI,
			functionName: 'verifiedUnitsOf' as const,
			args: [campaignId],
		})

		const result = this.client
			.callContract(runtime, {
				call: encodeCallMsg({ from: zeroAddress, to: this.address, data: callData }),
				blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
			})
			.result()

		return Number(
			decodeFunctionResult({
				abi: ProofAdsMarketABI,
				functionName: 'verifiedUnitsOf' as const,
				data: bytesToHex(result.data),
			}),
		)
	}
}
