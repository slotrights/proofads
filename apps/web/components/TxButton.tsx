'use client'

import { useState, type ReactNode } from 'react'
import { useWaitForTransactionReceipt } from 'wagmi'
import { txLink } from '@/lib/config'

/**
 * A button that runs one write and then reports what actually happened on chain.
 *
 * Deliberately does NOT update any local view state on success: callers refetch from chain.
 * Optimistic permission state is precisely what this project argues against.
 */
export function TxButton({
	children,
	onRun,
	onConfirmed,
	className,
	disabled,
	title,
}: {
	children: ReactNode
	onRun: () => Promise<`0x${string}`>
	onConfirmed?: () => void
	className?: string
	disabled?: boolean
	title?: string
}) {
	const [hash, setHash] = useState<`0x${string}` | undefined>()
	const [error, setError] = useState<string | null>(null)
	const [pending, setPending] = useState(false)
	const receipt = useWaitForTransactionReceipt({ hash })

	if (receipt.isSuccess && hash && onConfirmed) {
		onConfirmed()
	}

	return (
		<span>
			<button
				className={className}
				disabled={disabled || pending || receipt.isLoading}
				title={title}
				onClick={async () => {
					setError(null)
					setPending(true)
					try {
						setHash(await onRun())
					} catch (e) {
						setError(shortError(e))
					} finally {
						setPending(false)
					}
				}}
			>
				{pending ? 'Confirm in wallet…' : receipt.isLoading ? 'Mining…' : children}
			</button>
			{hash && (
				<div className="tiny mono" style={{ marginTop: 6 }}>
					{txLink(hash) ? (
						<a href={txLink(hash)} target="_blank" rel="noreferrer">
							{hash.slice(0, 18)}…
						</a>
					) : (
						<span className="muted">{hash.slice(0, 18)}…</span>
					)}{' '}
					{receipt.isSuccess ? <span className="ok">confirmed</span> : null}
				</div>
			)}
			{error && (
				<div className="err" style={{ marginTop: 6 }}>
					{error}
				</div>
			)}
		</span>
	)
}

/** Surfaces the contract's custom error name, which is the whole point of the ENS demo. */
export function shortError(e: unknown): string {
	const message = e instanceof Error ? e.message : String(e)
	const named = message.match(
		/(SellerNotAuthorized|SlotNotFound|AuctionNotEnded|AuctionEnded|ListingNotOpen|AlreadyBid|BidBelowReserve|NotSettlementReceiver|CampaignNotActive|DeadlineNotReached|WinnerCannotWithdraw|NothingToWithdraw|SlotAlreadyListed|SlotHasActiveCampaign|NonMonotonicReport|EACCannotGrantRoles|EACUnauthorizedAccountRoles)/,
	)
	if (named) return `Reverted: ${named[1]}`
	const first = message.split('\n')[0] ?? message
	return first.length > 180 ? `${first.slice(0, 180)}…` : first
}
