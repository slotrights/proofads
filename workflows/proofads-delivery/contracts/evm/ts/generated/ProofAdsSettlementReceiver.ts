/**
 * Hand-written twin of what `cre generate-bindings evm` produces for
 * `ProofAdsSettlementReceiver`, following the shape of the generated
 * `ReactorConsumer.ts` / `KeeperConsumer.ts` in the official CRE starter templates.
 *
 * It is checked in so the workflow typechecks and unit-tests without running the CRE CLI.
 * Running `cre generate-bindings evm` in this directory overwrites it with the generated
 * version; the `writeReport` body below is identical to the generated one.
 */
import {
	EVMClient,
	prepareReportRequest,
	type Runtime,
} from '@chainlink/cre-sdk'
import { encodeFunctionData } from 'viem'
import type { Address, Hex } from 'viem'
import { ProofAdsSettlementReceiverABI } from '../../../abi/ProofAdsSettlementReceiver'

export class ProofAdsSettlementReceiver {
	constructor(
		private readonly client: EVMClient,
		public readonly address: Address,
	) {}

	/**
	 * Ask the DON to sign `callData` as a report, then deliver it through the Chainlink
	 * Forwarder, which calls `onReport` on this receiver.
	 */
	writeReport(runtime: Runtime<unknown>, callData: Hex, gasConfig?: { gasLimit?: string }) {
		const reportResponse = runtime.report(prepareReportRequest(callData)).result()

		return this.client
			.writeReport(runtime, {
				receiver: this.address,
				report: reportResponse,
				gasConfig,
			})
			.result()
	}

	/** Convenience wrapper mirroring the generated `writeReportFrom<Fn>` helpers. */
	writeReportFromOnReport(
		runtime: Runtime<unknown>,
		metadata: Hex,
		report: Hex,
		gasConfig?: { gasLimit?: string },
	) {
		const callData = encodeFunctionData({
			abi: ProofAdsSettlementReceiverABI,
			functionName: 'onReport' as const,
			args: [metadata, report],
		})
		return this.writeReport(runtime, callData, gasConfig)
	}
}
