import { keccak256, toBytes, concatHex, type Hex } from 'viem'

/** `labelhash("hero")` — the id ENSv2 keys names by, and what ProofAds keys slots by. */
export function labelhash(label: string): Hex {
	return keccak256(toBytes(label))
}

/** ENSIP-1 namehash, used for resolver records. */
export function namehash(name: string): Hex {
	let node: Hex = `0x${'00'.repeat(32)}`
	if (name.length === 0) return node
	const labels = name.split('.')
	for (let i = labels.length - 1; i >= 0; i--) {
		node = keccak256(concatHex([node, labelhash(labels[i] as string)]))
	}
	return node
}

/** Split "hero.ads.proofads-pub.eth" into its labels, leaf first. */
export function labels(name: string): string[] {
	return name.split('.')
}

/**
 * Protocol-wide slot identity: the registry address plus the labelhash.
 *
 * Deliberately NOT the ERC-1155 token id — ENSv2 regenerates the token id every time a role
 * is granted or revoked (`PermissionedRegistry._onRolesGranted` -> `_regenerate`), so a token
 * id is not a stable key for anything.
 */
export function slotId(registry: Hex, label: string): Hex {
	// keccak256(abi.encode(address, bytes32)) === keccak256(0x000..registry || labelhash)
	const padded = `0x${registry.slice(2).toLowerCase().padStart(64, '0')}` as Hex
	return keccak256(concatHex([padded, labelhash(label)]))
}
