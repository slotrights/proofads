import { keccak256, toBytes, type Hex } from 'viem'

/**
 * `labelhash(label)` — how ENSv2 identifies a name and how ProofAds identifies an ad slot.
 * Duplicated here (rather than imported from @proofads/ens-client) so the API and the
 * workflow can depend on @proofads/shared alone.
 */
export function labelhashOfSlot(label: string): Hex {
	return keccak256(toBytes(label))
}
