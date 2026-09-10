import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'
import { Providers } from './providers'
import { TopNav } from '@/components/TopNav'

export const metadata: Metadata = {
	title: 'ProofAds',
	description:
		'Advertising inventory as a revocable ENSv2 rights hierarchy, settled against privately verified delivery.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<body>
				<Providers>
					<TopNav />
					<main className="wrap">{children}</main>
				</Providers>
			</body>
		</html>
	)
}
