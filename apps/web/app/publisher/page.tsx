'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAccount, usePublicClient, useWalletClient } from 'wagmi'
import { isAddress, type Address } from 'viem'
import { AdInventoryRegistryAbi, ProofAdsMarketAbi, ROLE_SELL_SLOT, MetricType } from '@proofads/shared'
import { labelhash } from '@proofads/ens-client'
import { TechnicalDetails } from '@/components/TechnicalDetails'
import { TxButton } from '@/components/TxButton'
import { config } from '@/lib/config'
import { useChainTime, useIsAuthorizedSeller, useSlots } from '@/lib/chain'

export default function PublisherPage() {
	const { address } = useAccount()
	const slots = useSlots()
	const [candidate, setCandidate] = useState('')
	const queryClient = useQueryClient()
	const refetchAll = () => queryClient.invalidateQueries()

	const candidateAddress = isAddress(candidate) ? (candidate as Address) : undefined

	return (
		<>
			<div className="banner">
				Selling rights are ENSv2 Enhanced Access Control roles. Granting <code>ROLE_SELL_SLOT</code>{' '}
				(<code>1 &lt;&lt; 40</code>, nybble 10) on one slot lets an agency list <em>that slot only</em>,
				and revoking it takes effect on the next marketplace call. Nothing below is cached: every
				badge is a fresh <code>hasRoles</code> read.
			</div>

			<div className="card">
				<h2>Delegate a seller</h2>
				<p className="sub">
					Type the address you want to authorize. The badges update from chain after each
					transaction confirms — never optimistically.
				</p>
				<div className="row">
					<div className="field" style={{ flex: '1 1 420px' }}>
						<label htmlFor="agency">Agency address</label>
						<input
							id="agency"
							className="mono"
							style={{ width: '100%' }}
							placeholder="0x…"
							value={candidate}
							onChange={(e) => setCandidate(e.target.value.trim())}
						/>
					</div>
				</div>
				{candidate && !candidateAddress && <p className="err">Not a valid address.</p>}
			</div>

			{slots.data?.map((slot) => (
				<SlotCard
					key={slot.label}
					label={slot.label}
					fullName={slot.fullName}
					owner={slot.owner}
					tokenId={slot.tokenId}
					connected={address}
					candidate={candidateAddress}
					onConfirmed={refetchAll}
				/>
			))}

			{!slots.data?.length && <p className="muted small">Reading the ENSv2 registry…</p>}
		</>
	)
}

function SlotCard({
	label,
	fullName,
	owner,
	tokenId,
	connected,
	candidate,
	onConfirmed,
}: {
	label: string
	fullName: string
	owner: Address
	tokenId: bigint
	connected: Address | undefined
	candidate: Address | undefined
	onConfirmed: () => void
}) {
	const { data: walletClient } = useWalletClient()
	const publicClient = usePublicClient()
	const candidateAuth = useIsAuthorizedSeller(label, candidate)
	const connectedAuth = useIsAuthorizedSeller(label, connected)
	const chainTime = useChainTime()
	const [targetUnits, setTargetUnits] = useState('2')
	const [reserve, setReserve] = useState('0.10')
	const [auctionMinutes, setAuctionMinutes] = useState('3')
	const [campaignMinutes, setCampaignMinutes] = useState('20')

	const isOwner = connected && owner.toLowerCase() === connected.toLowerCase()

	const write = async (functionName: 'grantRoles' | 'revokeRoles') => {
		if (!walletClient || !candidate) throw new Error('Connect a wallet and enter an address first')
		return walletClient.writeContract({
			address: config.adInventoryRegistry,
			abi: AdInventoryRegistryAbi,
			functionName,
			args: [BigInt(labelhash(label)), ROLE_SELL_SLOT, candidate],
		})
	}

	const createListing = async () => {
		if (!walletClient || !publicClient) throw new Error('Connect a wallet first')
		const nowSeconds = Number(chainTime.data ?? BigInt(Math.floor(Date.now() / 1000)))
		return walletClient.writeContract({
			address: config.market,
			abi: ProofAdsMarketAbi,
			functionName: 'createListing',
			args: [
				labelhash(label),
				MetricType.VIEW_10_SECONDS,
				Number(targetUnits),
				BigInt(Math.round(Number(reserve) * 1e6)),
				BigInt(nowSeconds + Number(auctionMinutes) * 60),
				Number(campaignMinutes) * 60,
			],
		})
	}

	return (
		<div className="card">
			<div className="spread">
				<h2 className="mono">{fullName}</h2>
				<span className="tiny muted">owner {owner.slice(0, 8)}…{owner.slice(-4)}</span>
			</div>
			<p className="sub">
				{isOwner ? 'You own this slot, so you may sell it and delegate selling rights.' : 'Connect the publisher wallet to delegate.'}
			</p>

			<div className="row" style={{ marginBottom: 12 }}>
				<span className="small">Candidate authorized:</span>
				{candidate ? (
					<span className={`pill ${candidateAuth.data ? 'yes' : 'no'}`}>
						{candidateAuth.isLoading ? '…' : candidateAuth.data ? 'ROLE_SELL_SLOT held' : 'not authorized'}
					</span>
				) : (
					<span className="pill neutral">enter an address above</span>
				)}
				<span className="small" style={{ marginLeft: 12 }}>Your wallet:</span>
				<span className={`pill ${connectedAuth.data ? 'yes' : 'no'}`}>
					{connected ? (connectedAuth.data ? 'may sell' : 'may not sell') : 'not connected'}
				</span>
			</div>

			<div className="row">
				<TxButton
					disabled={!candidate || !isOwner || candidateAuth.data === true}
					onRun={() => write('grantRoles')}
					onConfirmed={onConfirmed}
					title={!isOwner ? 'Only the slot owner holds ROLE_SELL_SLOT_ADMIN' : undefined}
				>
					Grant SELL
				</TxButton>
				<TxButton
					className="danger"
					disabled={!candidate || !isOwner || candidateAuth.data !== true}
					onRun={() => write('revokeRoles')}
					onConfirmed={onConfirmed}
				>
					Revoke SELL
				</TxButton>
			</div>

			<hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '18px 0' }} />

			<h2 style={{ fontSize: 15 }}>Open a listing</h2>
			<p className="sub">
				Anyone holding <code>ROLE_SELL_SLOT</code> on this slot can do this — the contract checks ENS,
				not this page.
			</p>
			<div className="row">
				<div className="field">
					<label>Target units</label>
					<input value={targetUnits} onChange={(e) => setTargetUnits(e.target.value)} />
				</div>
				<div className="field">
					<label>Reserve per unit (USDC)</label>
					<input value={reserve} onChange={(e) => setReserve(e.target.value)} />
				</div>
				<div className="field">
					<label>Auction (minutes)</label>
					<input value={auctionMinutes} onChange={(e) => setAuctionMinutes(e.target.value)} />
				</div>
				<div className="field">
					<label>Campaign (minutes)</label>
					<input value={campaignMinutes} onChange={(e) => setCampaignMinutes(e.target.value)} />
				</div>
				<div style={{ alignSelf: 'flex-end' }}>
					<TxButton disabled={!connected} onRun={createListing} onConfirmed={onConfirmed}>
						Create listing
					</TxButton>
				</div>
			</div>

			<TechnicalDetails
				rows={[
					{ label: 'labelhash', value: labelhash(label) },
					{ label: 'ERC-1155 token id', value: tokenId.toString() },
					{ label: 'ROLE_SELL_SLOT', value: `0x${ROLE_SELL_SLOT.toString(16)} (1 << 40)` },
					{ label: 'Registry', value: config.adInventoryRegistry, kind: 'address' },
				]}
			/>
		</div>
	)
}
