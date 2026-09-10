'use client'

import { addressLink, config, txLink } from '@/lib/config'

export type TechRow = { label: string; value: string; kind?: 'address' | 'tx' | 'text' }

/**
 * Every screen exposes the raw protocol state behind it. A judge should never have to take a
 * green badge on faith — the address, the labelhash and the transaction are one click away.
 */
export function TechnicalDetails({ rows }: { rows: TechRow[] }) {
	return (
		<details className="tech">
			<summary>Technical details</summary>
			<dl>
				<dt>Network</dt>
				<dd className="mono">
					chainId {config.chainId}
					{config.chainId === 31337 ? ' (local Anvil)' : ''}
					{config.chainId === 11155111 ? ' (Ethereum Sepolia)' : ''}
				</dd>
				{rows.map((row) => (
					<Row key={`${row.label}-${row.value}`} {...row} />
				))}
			</dl>
		</details>
	)
}

function Row({ label, value, kind = 'text' }: TechRow) {
	const href = kind === 'tx' ? txLink(value) : kind === 'address' ? addressLink(value) : ''
	return (
		<>
			<dt>{label}</dt>
			<dd className="mono">
				{href ? (
					<a href={href} target="_blank" rel="noreferrer">
						{value}
					</a>
				) : (
					value
				)}
			</dd>
		</>
	)
}
