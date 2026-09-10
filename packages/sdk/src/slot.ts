import { createPublicClient, http, keccak256, type Address, type Hex, type PublicClient } from 'viem'
import {
	CampaignStatus,
	MetricType,
	ProofAdsMarketAbi,
	labelhashOfSlot,
	type MeasurementEvent,
} from '@proofads/shared'
import { QualificationClock, type MeasureEmission } from './measure'

export type MountOptions = {
	/** ENS label of the slot, e.g. "hero" (the leaf of hero.ads.proofads-pub.eth). */
	slotLabel: string
	container: HTMLElement
	apiUrl: string
	rpcUrl: string
	marketAddress: Address
	/** Injected in tests; defaults to a viem public client over `rpcUrl`. */
	client?: PublicClient
	fetchImpl?: typeof fetch
	now?: () => number
	flushIntervalMs?: number
}

export type MountResult = {
	status: 'no-campaign' | 'creative-mismatch' | 'rendered' | 'world-required'
	campaignId?: number
	sessionId?: string
	stop: () => void
}

type ChainCampaign = {
	creativeHash: Hex
	creativeURI: string
	metric: number
	status: number
}

function newEventId(): string {
	return globalThis.crypto?.randomUUID?.() ?? `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * Mount a ProofAds slot on a publisher page.
 *
 * Everything the slot renders comes from chain: which campaign is active on this ENS slot,
 * which creative it bought, and the hash that creative must have. The SDK refuses to render
 * bytes whose keccak256 does not match the on-chain `creativeHash` — an advertiser cannot
 * swap the creative after winning, and a publisher cannot serve a different one.
 */
export async function mountProofAdsSlot(options: MountOptions): Promise<MountResult> {
	const doFetch = options.fetchImpl ?? fetch
	const now = options.now ?? (() => performance.now())
	const client =
		options.client ?? (createPublicClient({ transport: http(options.rpcUrl) }) as unknown as PublicClient)

	const labelhash = labelhashOfSlot(options.slotLabel)
	const campaignId = Number(
		(await client.readContract({
			address: options.marketAddress,
			abi: ProofAdsMarketAbi,
			functionName: 'activeCampaignForSlot',
			args: [labelhash],
		})) as bigint,
	)

	if (campaignId === 0) {
		options.container.replaceChildren(emptyState('No active campaign for this slot'))
		return { status: 'no-campaign', stop: () => {} }
	}

	const campaign = (await client.readContract({
		address: options.marketAddress,
		abi: ProofAdsMarketAbi,
		functionName: 'getCampaign',
		args: [BigInt(campaignId)],
	})) as unknown as ChainCampaign

	if (campaign.status !== CampaignStatus.ACTIVE) {
		options.container.replaceChildren(emptyState('No active campaign for this slot'))
		return { status: 'no-campaign', stop: () => {} }
	}

	if (campaign.metric === MetricType.SELFIE_CHECKED_VIEW_10_SECONDS) {
		// The premium metric requires a World Selfie Check credential. Not enabled in this MVP;
		// the SDK refuses rather than silently measuring an ineligible view.
		options.container.replaceChildren(
			emptyState('This campaign requires a World Selfie Check, which is not enabled in this build'),
		)
		return { status: 'world-required', campaignId, stop: () => {} }
	}

	// Fetch the creative and verify its bytes against the hash the advertiser committed to.
	const response = await doFetch(campaign.creativeURI)
	const bytes = new Uint8Array(await response.arrayBuffer())
	const actualHash = keccak256(bytes)
	if (actualHash.toLowerCase() !== campaign.creativeHash.toLowerCase()) {
		console.error(
			`[proofads] creative hash mismatch for slot ${options.slotLabel}: on-chain ${campaign.creativeHash}, fetched ${actualHash}`,
		)
		options.container.replaceChildren(emptyState('Creative failed verification'))
		return { status: 'creative-mismatch', campaignId, stop: () => {} }
	}

	const origin = globalThis.location?.origin ?? 'unknown'
	const sessionRes = await doFetch(`${options.apiUrl}/sessions`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ campaignId, slotLabel: options.slotLabel, origin }),
	})
	if (!sessionRes.ok) {
		options.container.replaceChildren(emptyState('Measurement unavailable'))
		return { status: 'no-campaign', campaignId, stop: () => {} }
	}
	const { sessionId } = (await sessionRes.json()) as { sessionId: string }

	const img = document.createElement('img')
	img.src = campaign.creativeURI
	img.alt = 'Advertisement'
	img.style.display = 'block'
	img.style.width = '100%'
	img.dataset.proofadsCampaign = String(campaignId)
	options.container.replaceChildren(img)

	// ── Measurement wiring ────────────────────────────────────────────
	const queue: MeasurementEvent[] = []
	const push = (emission: MeasureEmission) => {
		queue.push({
			eventId: newEventId(),
			sessionId,
			campaignId,
			eventType: emission.eventType,
			clientTime: Date.now(),
			// `performance.now()` is fractional, but the collector's schema (and the digest the
			// enclave recomputes) are integer milliseconds, so round at the boundary.
			visibilityRatio: Math.min(1, Math.max(0, emission.visibilityRatio)),
			visibleMs: Math.round(emission.visibleMs),
			creativeHash: campaign.creativeHash.toLowerCase() as Hex,
			origin,
			slotLabel: options.slotLabel,
		})
	}

	const clock = new QualificationClock({ onEmit: push })
	push({ eventType: 'CREATIVE_RENDERED', visibleMs: 0, visibilityRatio: 0, atMs: now() })
	clock.start(now())

	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) clock.setIntersection(entry.intersectionRatio, now())
		},
		{ threshold: [0, 0.25, 0.5, 0.75, 1] },
	)
	observer.observe(img)

	const onVisibility = () => clock.setPageVisible(document.visibilityState === 'visible', now())
	document.addEventListener('visibilitychange', onVisibility)

	const tickTimer = setInterval(() => clock.tick(now()), 250)

	const flush = async (useBeacon = false) => {
		if (queue.length === 0) return
		const payload = JSON.stringify({ sessionId, events: queue.splice(0, queue.length) })
		if (useBeacon && navigator.sendBeacon) {
			navigator.sendBeacon(`${options.apiUrl}/events`, new Blob([payload], { type: 'application/json' }))
			return
		}
		await doFetch(`${options.apiUrl}/events`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: payload,
		}).catch(() => {})
	}
	const flushTimer = setInterval(() => void flush(), options.flushIntervalMs ?? 2_000)
	const onPageHide = () => void flush(true)
	window.addEventListener('pagehide', onPageHide)

	return {
		status: 'rendered',
		campaignId,
		sessionId,
		stop: () => {
			observer.disconnect()
			document.removeEventListener('visibilitychange', onVisibility)
			window.removeEventListener('pagehide', onPageHide)
			clearInterval(tickTimer)
			clearInterval(flushTimer)
			void flush()
		},
	}
}

function emptyState(text: string): HTMLElement {
	const el = document.createElement('div')
	el.textContent = text
	el.style.cssText =
		'display:flex;align-items:center;justify-content:center;min-height:90px;border:1px dashed #cbd5e1;color:#64748b;font:13px system-ui,sans-serif;border-radius:8px'
	return el
}
