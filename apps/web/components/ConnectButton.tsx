'use client'

import { useAccount, useConnect, useDisconnect } from 'wagmi'

export function ConnectButton() {
	const { address, isConnected } = useAccount()
	const { connect, connectors, isPending } = useConnect()
	const { disconnect } = useDisconnect()

	if (isConnected && address) {
		return (
			<button className="ghost mono" onClick={() => disconnect()} title={address}>
				{address.slice(0, 6)}…{address.slice(-4)}
			</button>
		)
	}
	const connector = connectors[0]
	return (
		<button disabled={!connector || isPending} onClick={() => connector && connect({ connector })}>
			{isPending ? 'Connecting…' : 'Connect wallet'}
		</button>
	)
}
