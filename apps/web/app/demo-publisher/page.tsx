'use client'

import { useEffect, useRef, useState } from 'react'
import { usePublicClient } from 'wagmi'
import { chain } from '@/lib/wagmi'
import { mountProofAdsSlot, type MountResult } from '@proofads/sdk'
import { config } from '@/lib/config'

/**
 * "The Sepolia Times" — a plausible publisher page.
 *
 * Nothing about the ad is hardcoded here. `mountProofAdsSlot` asks the marketplace which
 * campaign is active on `hero.ads.<publisher>.eth`, fetches that campaign's creative, verifies
 * its keccak256 against the hash the advertiser committed to on chain, and only then renders it.
 */
export default function DemoPublisher() {
	return (
		<div style={{ background: '#f7f5f0', color: '#161616', margin: '-24px -20px', padding: '28px 20px 80px' }}>
			<div style={{ maxWidth: 980, margin: '0 auto' }}>
				<header style={{ borderBottom: '2px solid #161616', paddingBottom: 12, marginBottom: 20 }}>
					<div style={{ fontFamily: 'Georgia, serif', fontSize: 40, fontWeight: 700, letterSpacing: '-.02em' }}>
						The Sepolia Times
					</div>
					<div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.14em', color: '#666' }}>
						Independent since block zero
					</div>
				</header>

				<AdSlot label="hero" note="hero.ads — leaderboard above the fold" />

				<div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 32, marginTop: 24 }}>
					<article style={{ fontFamily: 'Georgia, serif', fontSize: 17, lineHeight: 1.65 }}>
						<h1 style={{ fontSize: 32, lineHeight: 1.2, margin: '0 0 10px' }}>
							Publishers begin selling attention they can actually prove
						</h1>
						<p style={{ color: '#555', fontSize: 14, fontFamily: 'system-ui', marginTop: 0 }}>
							By our markets desk
						</p>
						<p>
							For two decades the advertising supply chain has settled on assertions. A file at the
							root of a domain names who may resell its inventory; a spreadsheet somewhere claims how
							many people saw the result. Neither is enforceable, and neither is checkable by the
							party paying the bill.
						</p>
						<p>
							The arrangement on this page is narrower and duller, which is the point. The right to
							sell the banner above is a role on an ENS name. It was granted by the owner of that
							name, it can be taken back, and the contract that accepted the listing read it at the
							moment of the call rather than trusting a cached copy.
						</p>
						<p>
							What the advertiser pays for is equally narrow: a rendered creative that stayed at
							least half in view, on a foregrounded tab, for ten seconds. Whether that happened is
							decided from raw measurement data that neither the publisher nor the buyer gets to see
                            — it is evaluated inside a hardware enclave, which emits one number.
						</p>
						<p>
							None of this proves a person was watching. It proves a browser rendered a specific
							image for a specific duration, and that the money moved only for the portion that was
							delivered. That is a smaller claim than the industry usually makes, and a checkable one.
						</p>
					</article>

					<aside>
						<AdSlot label="sidebar" note="sidebar.ads — rail unit" />
						<div style={{ marginTop: 20, fontSize: 14, color: '#444' }}>
							<h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.1em', color: '#888' }}>
								Most read
							</h3>
							<ol style={{ paddingLeft: 18, lineHeight: 1.8 }}>
								<li>A registry, a role, and a revocation</li>
								<li>What an enclave will and will not tell you</li>
								<li>Escrow is not a business model, it is a receipt</li>
							</ol>
						</div>
					</aside>
				</div>
			</div>
		</div>
	)
}

function AdSlot({ label, note }: { label: string; note: string }) {
	const ref = useRef<HTMLDivElement>(null)
	const publicClient = usePublicClient({ chainId: chain.id })
	const [state, setState] = useState<MountResult['status'] | 'mounting'>('mounting')
	const [campaignId, setCampaignId] = useState<number | undefined>()

	useEffect(() => {
		if (!ref.current || !publicClient) return
		let result: MountResult | null = null
		void (async () => {
			try {
				result = await mountProofAdsSlot({
					slotLabel: label,
					container: ref.current!,
					apiUrl: config.apiUrl,
					rpcUrl: config.rpcUrl,
					marketAddress: config.market,
					client: publicClient as never,
				})
				setState(result.status)
				setCampaignId(result.campaignId)
			} catch (error) {
				console.error('[proofads] mount failed', error)
				setState('no-campaign')
			}
		})()
		return () => result?.stop()
	}, [label, publicClient])

	return (
		<section>
			<div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.16em', color: '#999', marginBottom: 4 }}>
				Advertisement · {note}
			</div>
			<div ref={ref} style={{ minHeight: 90, background: '#ece8e0', borderRadius: 6 }} />
			<div style={{ fontSize: 11, color: '#999', marginTop: 4, fontFamily: 'ui-monospace, monospace' }}>
				{label}.ads.{config.publisherName}
				{campaignId ? ` · campaign #${campaignId}` : ''}
				{state === 'creative-mismatch' ? ' · creative failed hash verification' : ''}
				{state === 'no-campaign' ? ' · no active campaign' : ''}
			</div>
		</section>
	)
}
