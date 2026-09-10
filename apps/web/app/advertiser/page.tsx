'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { useAccount, useWalletClient } from 'wagmi'
import { formatUnits, keccak256, type Address, type Hex } from 'viem'
import { ListingStatus, METRIC_LABELS, MockUSDCAbi, ProofAdsMarketAbi, type MetricType } from '@proofads/shared'
import { TechnicalDetails } from '@/components/TechnicalDetails'
import { TxButton } from '@/components/TxButton'
import { config, slotFullName } from '@/lib/config'
import { useBids, useChainTime, useIsAuthorizedSeller, useListings, useSlots, useUsdcBalance } from '@/lib/chain'

/** Two creatives ship with the demo; the browser hashes the bytes it will actually render. */
const CREATIVES = [
	{ id: 'adv-a', label: 'Creative A — blue', path: '/creatives/adv-a.png' },
	{ id: 'adv-b', label: 'Creative B — amber', path: '/creatives/adv-b.png' },
] as const

export default function AdvertiserPage() {
	const { address } = useAccount()
	const listings = useListings()
	const slots = useSlots()
	const balance = useUsdcBalance(address)
	const open = (listings.data ?? []).filter((l) => l.status === ListingStatus.OPEN)
	const finalized = (listings.data ?? []).filter((l) => l.status !== ListingStatus.OPEN)

	return (
		<>
			<div className="banner">
				A bid escrows <code>unitPrice × targetUnits</code> of USDC in the marketplace contract up
				front. The winner&apos;s escrow is released only as delivery is verified; the losers withdraw
				in full.
			</div>

			<div className="card">
				<div className="spread">
					<h2>Your balance</h2>
					<span className="mono">
						{balance.data !== undefined ? `${formatUnits(balance.data, 6)} USDC` : '—'}
					</span>
				</div>
				<p className="sub">Settlement currency: {config.usdc}</p>
			</div>

			{open.length === 0 && (
				<div className="card">
					<h2>No open listings</h2>
					<p className="sub">
						Open one from the <Link href="/publisher">publisher</Link> page.
					</p>
				</div>
			)}

			{open.map((listing) => (
				<ListingCard
					key={listing.id.toString()}
					listingId={listing.id}
					labelhash={listing.labelhash}
					seller={listing.seller}
					metric={listing.metric}
					targetUnits={listing.targetUnits}
					reserve={listing.reserveUnitPrice}
					auctionEnd={listing.auctionEnd}
					slotLabel={slots.data?.find((s) => s.labelhash === listing.labelhash)?.label}
					account={address}
				/>
			))}

			{finalized.length > 0 && (
				<div className="card">
					<h2>Settled listings</h2>
					<table>
						<thead>
							<tr><th>#</th><th>Status</th><th>Campaign</th><th /></tr>
						</thead>
						<tbody>
							{finalized.map((l) => (
								<tr key={l.id.toString()}>
									<td>{l.id.toString()}</td>
									<td>{l.status === ListingStatus.FINALIZED ? 'finalized' : 'cancelled'}</td>
									<td>{l.campaignId > 0n ? <Link href={`/campaign/${l.campaignId}`}>#{l.campaignId.toString()}</Link> : '—'}</td>
									<td><WithdrawButton listingId={l.id} account={address} /></td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</>
	)
}

function ListingCard(props: {
	listingId: bigint
	labelhash: Hex
	seller: Address
	metric: number
	targetUnits: number
	reserve: bigint
	auctionEnd: bigint
	slotLabel: string | undefined
	account: Address | undefined
}) {
	const { data: walletClient } = useWalletClient()
	const bids = useBids(props.listingId)
	const chainTime = useChainTime()
	const sellerAuth = useIsAuthorizedSeller(props.slotLabel, props.seller)
	const queryClient = useQueryClient()
	const refetchAll = () => queryClient.invalidateQueries()

	const [creativeId, setCreativeId] = useState<string>(CREATIVES[0].id)
	const [unitPrice, setUnitPrice] = useState(formatUnits(props.reserve, 6))
	const [creativeHash, setCreativeHash] = useState<Hex | null>(null)

	const creative = CREATIVES.find((c) => c.id === creativeId) ?? CREATIVES[0]

	// Hash the exact bytes that will be served, in the browser. The SDK re-does this before it
	// renders anything, so a creative swapped after the auction simply fails to display.
	useEffect(() => {
		let cancelled = false
		void (async () => {
			const res = await fetch(creative.path)
			const bytes = new Uint8Array(await res.arrayBuffer())
			if (!cancelled) setCreativeHash(keccak256(bytes))
		})()
		return () => {
			cancelled = true
		}
	}, [creative.path])

	const ended = chainTime.data ? chainTime.data >= props.auctionEnd : false
	const escrow = BigInt(Math.round(Number(unitPrice) * 1e6)) * BigInt(props.targetUnits)
	const alreadyBid = bids.data?.some((b) => b.bidder.toLowerCase() === props.account?.toLowerCase())

	const approveAndBid = async () => {
		if (!walletClient || !creativeHash) throw new Error('Connect a wallet first')
		const approval = await walletClient.writeContract({
			address: config.usdc, abi: MockUSDCAbi, functionName: 'approve', args: [config.market, escrow],
		})
		// Wait for the approval to land before the bid, so the transfer cannot race it.
		await new Promise((r) => setTimeout(r, 1500))
		void approval
		return walletClient.writeContract({
			address: config.market,
			abi: ProofAdsMarketAbi,
			functionName: 'placeBid',
			args: [
				props.listingId,
				BigInt(Math.round(Number(unitPrice) * 1e6)),
				creativeHash,
				`${typeof window !== 'undefined' ? window.location.origin : ''}${creative.path}`,
			],
		})
	}

	const finalize = async () => {
		if (!walletClient) throw new Error('Connect a wallet first')
		return walletClient.writeContract({
			address: config.market, abi: ProofAdsMarketAbi, functionName: 'finalizeAuction',
			args: [props.listingId],
		})
	}

	return (
		<div className="card">
			<div className="spread">
				<h2 className="mono">
					Listing #{props.listingId.toString()} · {props.slotLabel ? slotFullName(props.slotLabel) : props.labelhash.slice(0, 14)}
				</h2>
				<span className={`pill ${sellerAuth.data ? 'yes' : 'no'}`}>
					{sellerAuth.isLoading ? '…' : sellerAuth.data ? 'seller still authorized' : 'seller no longer authorized'}
				</span>
			</div>
			<p className="sub">
				{METRIC_LABELS[props.metric as MetricType]} · target {props.targetUnits} units · reserve{' '}
				{formatUnits(props.reserve, 6)} USDC/unit · auction ends{' '}
				{new Date(Number(props.auctionEnd) * 1000).toLocaleTimeString()}
			</p>

			{!sellerAuth.data && !sellerAuth.isLoading && (
				<div className="banner warn">
					This seller&apos;s ENS role has been revoked. Finalizing now will cancel the listing and make
					every bid withdrawable — the contract re-checks ENS at that moment.
				</div>
			)}

			<div className="row">
				<div className="field">
					<label>Creative</label>
					<select value={creativeId} onChange={(e) => setCreativeId(e.target.value)}>
						{CREATIVES.map((c) => (
							<option key={c.id} value={c.id}>{c.label}</option>
						))}
					</select>
				</div>
				<div className="field">
					<label>Unit price (USDC)</label>
					<input value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
				</div>
				<div className="field">
					<label>Escrow required</label>
					<input readOnly value={`${formatUnits(escrow, 6)} USDC`} />
				</div>
				<div style={{ alignSelf: 'flex-end' }}>
					{ended ? (
						<TxButton onRun={finalize} onConfirmed={refetchAll}>Finalize auction</TxButton>
					) : (
						<TxButton
							disabled={!props.account || !creativeHash || alreadyBid}
							title={alreadyBid ? 'One bid per address per listing' : undefined}
							onRun={approveAndBid}
							onConfirmed={refetchAll}
						>
							{alreadyBid ? 'Already bid' : 'Approve + bid'}
						</TxButton>
					)}
				</div>
			</div>

			<img
				src={creative.path}
				alt=""
				style={{ marginTop: 14, width: '100%', maxWidth: 420, borderRadius: 8, border: '1px solid var(--line)' }}
			/>

			{bids.data && bids.data.length > 0 && (
				<table style={{ marginTop: 14 }}>
					<thead><tr><th>Bidder</th><th>Unit price</th><th>Escrow</th><th>Creative</th></tr></thead>
					<tbody>
						{bids.data.map((bid, i) => (
							<tr key={i}>
								<td className="mono tiny">{bid.bidder}</td>
								<td>{formatUnits(bid.unitPrice, 6)}</td>
								<td>{formatUnits(bid.escrow, 6)}</td>
								<td className="mono tiny">{bid.creativeHash.slice(0, 12)}…</td>
							</tr>
						))}
					</tbody>
				</table>
			)}

			<TechnicalDetails
				rows={[
					{ label: 'Seller', value: props.seller, kind: 'address' },
					{ label: 'Slot labelhash', value: props.labelhash },
					{ label: 'Creative keccak256', value: creativeHash ?? 'hashing…' },
					{ label: 'Market', value: config.market, kind: 'address' },
				]}
			/>
		</div>
	)
}

function WithdrawButton({ listingId, account }: { listingId: bigint; account: Address | undefined }) {
	const { data: walletClient } = useWalletClient()
	const queryClient = useQueryClient()
	return (
		<TxButton
			className="ghost"
			disabled={!account}
			onRun={async () => {
				if (!walletClient) throw new Error('Connect a wallet first')
				return walletClient.writeContract({
					address: config.market, abi: ProofAdsMarketAbi, functionName: 'withdrawBid', args: [listingId],
				})
			}}
			onConfirmed={() => queryClient.invalidateQueries()}
		>
			Withdraw bid
		</TxButton>
	)
}
