'use client'

import Link from 'next/link'
import { formatUnits } from 'viem'
import { METRIC_LABELS, ListingStatus, type MetricType } from '@proofads/shared'
import { TechnicalDetails } from '@/components/TechnicalDetails'
import { config, slotFullName } from '@/lib/config'
import { useChainTime, useListings, useSlots } from '@/lib/chain'

const STATUS_LABEL: Record<number, string> = {
	[ListingStatus.NONE]: 'unknown',
	[ListingStatus.OPEN]: 'open',
	[ListingStatus.FINALIZED]: 'finalized',
	[ListingStatus.CANCELLED]: 'cancelled',
}

export default function InventoryPage() {
	const slots = useSlots()
	const listings = useListings()
	const chainTime = useChainTime()

	return (
		<>
			<div className="banner">
				<strong>ProofAds</strong> — advertising inventory is an ENSv2 name hierarchy. The right to
				sell one slot is a revocable Enhanced Access Control role, and the marketplace re-reads it
				from ENS on every call. Advertisers pay only for delivery that a Chainlink Confidential
				Workflow verified privately.
			</div>

			<div className="card">
				<h2>Inventory</h2>
				<p className="sub">
					Slots under <code>ads.{config.publisherName}</code>, read live from the ENSv2 registry.
				</p>
				{slots.isLoading && <p className="muted small">Reading the registry…</p>}
				{slots.data && slots.data.length > 0 && (
					<table>
						<thead>
							<tr>
								<th>ENS name</th>
								<th>Placement</th>
								<th>Website</th>
								<th>Owner (publisher)</th>
								<th>Expires</th>
							</tr>
						</thead>
						<tbody>
							{slots.data.map((slot) => (
								<tr key={slot.label}>
									<td className="mono">{slot.fullName}</td>
									<td>{slot.placement || <span className="muted">—</span>}</td>
									<td>{slot.domain || <span className="muted">—</span>}</td>
									<td className="mono tiny">{slot.owner}</td>
									<td className="tiny muted">
										{slot.expiry > 0n ? new Date(Number(slot.expiry) * 1000).toISOString().slice(0, 10) : '—'}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
				<TechnicalDetails
					rows={[
						{ label: 'AdInventoryRegistry', value: config.adInventoryRegistry, kind: 'address' },
						{ label: 'Authorization adapter', value: config.authorizationAdapter, kind: 'address' },
						{ label: 'Publisher resolver', value: config.publisherResolver, kind: 'address' },
						...(slots.data ?? []).map((s) => ({
							label: `labelhash(${s.label})`,
							value: s.labelhash,
						})),
					]}
				/>
			</div>

			<div className="card">
				<h2>Listings</h2>
				<p className="sub">Every listing ever opened on this marketplace, straight from the contract.</p>
				{listings.isLoading && <p className="muted small">Reading listings…</p>}
				{listings.data?.length === 0 && (
					<p className="muted small">
						No listings yet. A publisher or an authorized agency can open one from the{' '}
						<Link href="/publisher">publisher</Link> page.
					</p>
				)}
				{listings.data && listings.data.length > 0 && (
					<table>
						<thead>
							<tr>
								<th>#</th>
								<th>Slot</th>
								<th>Metric</th>
								<th>Target</th>
								<th>Reserve</th>
								<th>Auction ends</th>
								<th>Status</th>
								<th />
							</tr>
						</thead>
						<tbody>
							{listings.data.map((listing) => {
								const slot = slots.data?.find((s) => s.labelhash === listing.labelhash)
								const ended = chainTime.data ? chainTime.data >= listing.auctionEnd : false
								return (
									<tr key={listing.id.toString()}>
										<td>{listing.id.toString()}</td>
										<td className="mono tiny">{slot ? slotFullName(slot.label) : listing.labelhash.slice(0, 14)}</td>
										<td className="tiny">{METRIC_LABELS[listing.metric as MetricType]}</td>
										<td>{listing.targetUnits}</td>
										<td>{formatUnits(listing.reserveUnitPrice, 6)} USDC</td>
										<td className="tiny">
											{new Date(Number(listing.auctionEnd) * 1000).toLocaleTimeString()}{' '}
											{ended && listing.status === ListingStatus.OPEN && (
												<span className="pill warn">ready to finalize</span>
											)}
										</td>
										<td>
											<span className={`pill ${listing.status === ListingStatus.OPEN ? 'yes' : 'neutral'}`}>
												{STATUS_LABEL[listing.status]}
											</span>
										</td>
										<td>
											{listing.campaignId > 0n && (
												<Link href={`/campaign/${listing.campaignId}`}>campaign →</Link>
											)}
										</td>
									</tr>
								)
							})}
						</tbody>
					</table>
				)}
				<TechnicalDetails rows={[{ label: 'ProofAdsMarket', value: config.market, kind: 'address' }]} />
			</div>
		</>
	)
}
