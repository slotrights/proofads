'use client'

import { use, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useWalletClient } from 'wagmi'
import { formatUnits } from 'viem'
import { CampaignStatus, METRIC_LABELS, ProofAdsMarketAbi, type MetricType } from '@proofads/shared'
import { TechnicalDetails } from '@/components/TechnicalDetails'
import { TxButton } from '@/components/TxButton'
import { config } from '@/lib/config'
import { useCampaign, useChainTime, useSlots } from '@/lib/chain'

type Summary = {
	campaignId: number
	totalEvents: number
	qualifyingEvents: number
	distinctSessions: number
	unbatchedEvents: number
	batches: { id: string; digest: string; eventCount: number; closedAt: string }[]
}

export default function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = use(params)
	const campaignId = BigInt(id)
	const campaign = useCampaign(campaignId)
	const slots = useSlots()
	const chainTime = useChainTime()
	const { data: walletClient } = useWalletClient()
	const queryClient = useQueryClient()
	const [summary, setSummary] = useState<Summary | null>(null)

	useEffect(() => {
		let cancelled = false
		const load = async () => {
			try {
				const res = await fetch(`${config.apiUrl}/campaigns/${id}/summary`)
				if (res.ok && !cancelled) setSummary((await res.json()) as Summary)
			} catch {
				/* the collector may not be running; the chain view still works */
			}
		}
		void load()
		const timer = setInterval(load, 4000)
		return () => {
			cancelled = true
			clearInterval(timer)
		}
	}, [id])

	if (campaign.isLoading) return <p className="muted">Reading the campaign…</p>
	if (!campaign.data || campaign.data.status === CampaignStatus.NONE) {
		return <p className="muted">No such campaign.</p>
	}

	const c = campaign.data
	const slot = slots.data?.find((s) => s.labelhash === c.labelhash)
	const released = formatUnits(c.paidAmount, 6)
	const remaining = formatUnits(c.totalBudget - c.paidAmount, 6)
	const pastDeadline = chainTime.data ? chainTime.data >= c.deadline : false

	return (
		<>
			<div className="card">
				<div className="spread">
					<h2>Campaign #{id}</h2>
					<span className={`pill ${c.status === CampaignStatus.ACTIVE ? 'yes' : 'neutral'}`}>
						{c.status === CampaignStatus.ACTIVE ? 'active' : 'closed'}
					</span>
				</div>
				<p className="sub">
					{slot ? slot.fullName : c.labelhash} · {METRIC_LABELS[c.metric as MetricType]}
				</p>

				<div className="grid two">
					<div>
						<table>
							<tbody>
								<tr><th>Publisher</th><td className="mono tiny">{c.publisher}</td></tr>
								<tr><th>Seller</th><td className="mono tiny">{c.seller}</td></tr>
								<tr><th>Advertiser</th><td className="mono tiny">{c.advertiser}</td></tr>
								<tr><th>Website</th><td>{slot?.domain || '—'}</td></tr>
							</tbody>
						</table>
					</div>
					<div>
						<table>
							<tbody>
								<tr>
									<th>Verified delivery</th>
									<td><strong>{c.verifiedUnits}</strong> of {c.targetUnits} units</td>
								</tr>
								<tr><th>Unit price</th><td>{formatUnits(c.unitPrice, 6)} USDC</td></tr>
								<tr><th>Budget</th><td>{formatUnits(c.totalBudget, 6)} USDC</td></tr>
								<tr><th>Released to publisher</th><td className="ok">{released} USDC</td></tr>
								<tr><th>Still escrowed</th><td>{remaining} USDC</td></tr>
								<tr>
									<th>Deadline</th>
									<td className="tiny">{new Date(Number(c.deadline) * 1000).toLocaleString()}</td>
								</tr>
							</tbody>
						</table>
					</div>
				</div>

				{c.status === CampaignStatus.ACTIVE && (
					<div style={{ marginTop: 14 }}>
						<TxButton
							disabled={!pastDeadline}
							title={pastDeadline ? undefined : 'Only after the campaign deadline'}
							onRun={async () => {
								if (!walletClient) throw new Error('Connect a wallet first')
								return walletClient.writeContract({
									address: config.market, abi: ProofAdsMarketAbi,
									functionName: 'closeCampaign', args: [campaignId],
								})
							}}
							onConfirmed={() => queryClient.invalidateQueries()}
						>
							Close campaign and refund the remainder
						</TxButton>
					</div>
				)}

				<TechnicalDetails
					rows={[
						{ label: 'Creative hash (on chain)', value: c.creativeHash },
						{ label: 'Creative URI', value: c.creativeURI },
						{ label: 'Market', value: config.market, kind: 'address' },
						{ label: 'Settlement receiver', value: config.settlementReceiver, kind: 'address' },
					]}
				/>
			</div>

			<div className="card">
				<h2>Measurement</h2>
				<p className="sub">
					Counts only. The raw events behind them never leave the collector except into the
					Chainlink enclave, over an authenticated request.
				</p>
				{!summary && <p className="muted small">Collector not reachable at {config.apiUrl}.</p>}
				{summary && (
					<>
						<div className="row">
							<Stat label="Raw events" value={summary.totalEvents} />
							<Stat label="Qualifying views" value={summary.qualifyingEvents} />
							<Stat label="Distinct sessions" value={summary.distinctSessions} />
							<Stat label="Not yet batched" value={summary.unbatchedEvents} />
						</div>
						{summary.batches.length > 0 && (
							<table style={{ marginTop: 14 }}>
								<thead><tr><th>Batch</th><th>Events</th><th>Digest</th><th>Closed</th></tr></thead>
								<tbody>
									{summary.batches.map((b) => (
										<tr key={b.id}>
											<td className="mono tiny">{b.id.slice(0, 8)}…</td>
											<td>{b.eventCount}</td>
											<td className="mono tiny">{b.digest.slice(0, 18)}…</td>
											<td className="tiny">{new Date(b.closedAt).toLocaleTimeString()}</td>
										</tr>
									))}
								</tbody>
							</table>
						)}
					</>
				)}
			</div>
		</>
	)
}

function Stat({ label, value }: { label: string; value: number }) {
	return (
		<div style={{ flex: '1 1 140px' }}>
			<div className="tiny muted">{label}</div>
			<div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
		</div>
	)
}
