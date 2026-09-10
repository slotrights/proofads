'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ConnectButton } from './ConnectButton'

const LINKS = [
	['/', 'Inventory'],
	['/publisher', 'Publisher'],
	['/advertiser', 'Advertiser'],
	['/demo-publisher', 'Demo site'],
] as const

export function TopNav() {
	const pathname = usePathname()
	return (
		<header className="top">
			<div className="wrap">
				<Link href="/" className="brand" style={{ textDecoration: 'none', color: 'inherit' }}>
					Proof<span>Ads</span>
				</Link>
				<nav>
					{LINKS.map(([href, label]) => (
						<Link key={href} href={href} className={pathname === href ? 'active' : ''}>
							{label}
						</Link>
					))}
				</nav>
				<ConnectButton />
			</div>
		</header>
	)
}
