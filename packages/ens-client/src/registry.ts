import type { Address, Hex, PublicClient, WalletClient, Account } from 'viem'
import {
	AdInventoryRegistryAbi,
	ENSv2AuthorizationAdapterAbi,
	PermissionedRegistryAbi,
	PermissionedResolverAbi,
	LabelStoreAbi,
	ROLE_SELL_SLOT,
} from '@proofads/shared'
import { labelhash, namehash } from './names'

export type SlotView = {
	label: string
	labelhash: Hex
	owner: Address
	expiry: bigint
	tokenId: bigint
	/** Live, per-query authorization. Never cached in application state. */
	authorized: boolean
	placement: string
	domain: string
}

/** Is `account` allowed to sell this slot *right now*, according to ENSv2 EAC? */
export async function readIsAuthorizedSeller(
	client: PublicClient,
	registry: Address,
	label: string,
	account: Address,
): Promise<boolean> {
	return client.readContract({
		address: registry,
		abi: AdInventoryRegistryAbi,
		functionName: 'isAuthorizedSeller',
		args: [BigInt(labelhash(label)), account],
	}) as Promise<boolean>
}

/** The raw EAC check, for UIs that want to show the bitmap rather than the sugar. */
export async function readHasSellRole(
	client: PublicClient,
	registry: Address,
	label: string,
	account: Address,
): Promise<boolean> {
	return client.readContract({
		address: registry,
		abi: AdInventoryRegistryAbi,
		functionName: 'hasRoles',
		args: [BigInt(labelhash(label)), ROLE_SELL_SLOT, account],
	}) as Promise<boolean>
}

export async function readSlotOwner(
	client: PublicClient,
	registry: Address,
	label: string,
): Promise<Address> {
	return client.readContract({
		address: registry,
		abi: AdInventoryRegistryAbi,
		functionName: 'getOwner',
		args: [BigInt(labelhash(label))],
	}) as Promise<Address>
}

export async function readTextRecord(
	client: PublicClient,
	resolver: Address,
	name: string,
	key: string,
): Promise<string> {
	return client.readContract({
		address: resolver,
		abi: PermissionedResolverAbi,
		functionName: 'text',
		args: [namehash(name), key],
	}) as Promise<string>
}

/** Read every field a UI needs about a slot, all from chain. */
export async function readSlot(
	client: PublicClient,
	opts: {
		registry: Address
		resolver: Address
		label: string
		fullName: string
		candidateSeller?: Address
	},
): Promise<SlotView> {
	const id = BigInt(labelhash(opts.label))
	const [owner, expiry, tokenId] = await Promise.all([
		client.readContract({
			address: opts.registry,
			abi: AdInventoryRegistryAbi,
			functionName: 'getOwner',
			args: [id],
		}) as Promise<Address>,
		client.readContract({
			address: opts.registry,
			abi: AdInventoryRegistryAbi,
			functionName: 'getExpiry',
			args: [id],
		}) as Promise<bigint>,
		client.readContract({
			address: opts.registry,
			abi: AdInventoryRegistryAbi,
			functionName: 'getTokenId',
			args: [id],
		}) as Promise<bigint>,
	])

	const [authorized, placement, domain] = await Promise.all([
		opts.candidateSeller
			? readIsAuthorizedSeller(client, opts.registry, opts.label, opts.candidateSeller)
			: Promise.resolve(false),
		readTextRecord(client, opts.resolver, opts.fullName, 'com.proofads.placement').catch(() => ''),
		readTextRecord(client, opts.resolver, opts.fullName, 'com.proofads.domain').catch(() => ''),
	])

	return {
		label: opts.label,
		labelhash: labelhash(opts.label),
		owner,
		expiry,
		tokenId,
		authorized,
		placement,
		domain,
	}
}

/**
 * Enumerate the slots in an inventory registry from its `LabelRegistered` events, then invert
 * each labelhash back to a string through the shared `LabelStore`.
 *
 * No subgraph, no indexer (MVP rule 13) — an inventory has a handful of slots.
 */
export async function listSlots(
	client: PublicClient,
	registry: Address,
	labelStore: Address,
	fromBlock: bigint = 0n,
): Promise<string[]> {
	const logs = await client.getContractEvents({
		address: registry,
		abi: AdInventoryRegistryAbi,
		eventName: 'LabelRegistered',
		fromBlock,
		toBlock: 'latest',
	})
	const seen = new Set<string>()
	for (const log of logs) {
		const args = log.args as { label?: string; labelHash?: Hex }
		if (args.label) {
			seen.add(args.label)
		} else if (args.labelHash) {
			const label = (await client.readContract({
				address: labelStore,
				abi: LabelStoreAbi,
				functionName: 'getLabel',
				args: [BigInt(args.labelHash)],
			})) as string
			if (label) seen.add(label)
		}
	}
	return [...seen]
}

/**
 * Walk the ENSv2 registry hierarchy the way UniversalResolverV2 does, one
 * `getSubregistry(label)` hop per label, right to left.
 *
 * On Sepolia the deployed `UniversalResolverV2` can do this in one call; walking it here keeps
 * the local chain and Sepolia on the same code path and makes the hierarchy visible in the UI.
 */
export async function resolveRegistryPath(
	client: PublicClient,
	rootRegistry: Address,
	name: string,
): Promise<{ label: string; registry: Address }[]> {
	const parts = name.split('.').reverse()
	const path: { label: string; registry: Address }[] = [{ label: '', registry: rootRegistry }]
	let current = rootRegistry
	for (const label of parts) {
		const next = (await client.readContract({
			address: current,
			abi: PermissionedRegistryAbi,
			functionName: 'getSubregistry',
			args: [label],
		})) as Address
		path.push({ label, registry: next })
		if (next === '0x0000000000000000000000000000000000000000') break
		current = next
	}
	return path
}

/** Grant `ROLE_SELL_SLOT` on one slot. Only an account holding the admin role may do this. */
export async function grantSell(
	wallet: WalletClient,
	account: Account | Address,
	registry: Address,
	label: string,
	to: Address,
): Promise<Hex> {
	return wallet.writeContract({
		chain: wallet.chain,
		account,
		address: registry,
		abi: AdInventoryRegistryAbi,
		functionName: 'grantRoles',
		args: [BigInt(labelhash(label)), ROLE_SELL_SLOT, to],
	})
}

export async function revokeSell(
	wallet: WalletClient,
	account: Account | Address,
	registry: Address,
	label: string,
	from: Address,
): Promise<Hex> {
	return wallet.writeContract({
		chain: wallet.chain,
		account,
		address: registry,
		abi: AdInventoryRegistryAbi,
		functionName: 'revokeRoles',
		args: [BigInt(labelhash(label)), ROLE_SELL_SLOT, from],
	})
}

/** The adapter's view — publisher, live authorization and expiry in a single call. */
export async function describeSlot(
	client: PublicClient,
	adapter: Address,
	label: string,
	seller: Address,
): Promise<{ publisher: Address; authorized: boolean; expiry: bigint }> {
	const [publisher, authorized, expiry] = (await client.readContract({
		address: adapter,
		abi: ENSv2AuthorizationAdapterAbi,
		functionName: 'describeSlot',
		args: [labelhash(label), seller],
	})) as [Address, boolean, bigint]
	return { publisher, authorized, expiry }
}
