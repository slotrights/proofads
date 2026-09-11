/**
 * Re-captures the UI evidence screenshots against whatever network the web app is built for,
 * with every "Technical details" panel expanded.
 *
 * It refuses to run unless the app is pointed at Sepolia — the previous set of screenshots was
 * taken against local Anvil, and a screenshot whose Network row reads "chainId 31337 (local
 * Anvil)" quietly contradicts a submission that claims a public deployment. Fail loudly rather
 * than ship that twice.
 *
 *   AGENCY_ADDRESS=0x… CAMPAIGN_ID=3 node apps/e2e/browser/capture-evidence.mjs
 *   WEB_URL=http://127.0.0.1:3000 node apps/e2e/browser/capture-evidence.mjs   # a local server
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const OUT = join(ROOT, 'docs/evidence')
const WEB_URL = process.env.WEB_URL ?? 'https://proofads.charmine.xyz'
const CAMPAIGN_ID = process.env.CAMPAIGN_ID ?? '2'
const EXPECT_CHAIN = process.env.EXPECT_CHAIN ?? '11155111'
// Address to type into the publisher page's "Agency address" field. The page then does a live
// hasRoles() read and lights the "Candidate authorized" badge — which is the ENS claim made
// visible. Without it the screenshot shows an empty form.
const AGENCY = process.env.AGENCY_ADDRESS ?? ''

mkdirSync(OUT, { recursive: true })

const PAGES = [
	{ file: 'ui-inventory.png', path: '/' },
	{ file: 'ui-publisher.png', path: '/publisher', fillAgency: true },
	{ file: 'ui-advertiser.png', path: '/advertiser' },
	{ file: 'ui-campaign.png', path: `/campaign/${CAMPAIGN_ID}` },
	{ file: 'ui-demo-publisher.png', path: '/demo-publisher', dwellMs: 13_000 },
]

const browser = await chromium.launch({
	args: ['--no-sandbox'],
	...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
})
const page = await browser.newPage({
	viewport: { width: 1440, height: 1000 },
	deviceScaleFactor: 2,
})

let checked = false
for (const { file, path, dwellMs, fillAgency } of PAGES) {
	process.stdout.write(`${path} … `)
	await page.goto(WEB_URL + path, { waitUntil: 'networkidle' })

	// Open every disclosure so the raw protocol state is visible in the image.
	await page.evaluate(() => {
		for (const d of document.querySelectorAll('details')) d.open = true
	})

	if (!checked) {
		const network = await page.evaluate(() => {
			const dt = [...document.querySelectorAll('details.tech dt')].find(
				(el) => el.textContent?.trim() === 'Network',
			)
			return dt?.nextElementSibling?.textContent?.trim() ?? ''
		})
		if (!network.includes(EXPECT_CHAIN)) {
			await browser.close()
			throw new Error(
				`Refusing to capture: the web app reports "${network || '(no Network row found)'}", ` +
					`expected chainId ${EXPECT_CHAIN}.\n` +
					`Rebuild it for Sepolia first:\n` +
					`  node scripts/write-web-env.mjs sepolia && pnpm --filter @proofads/web build`,
			)
		}
		console.log(`\n  network: ${network}`)
		checked = true
		process.stdout.write(`${path} … `)
	}

	// React controlled inputs ignore a plain .value assignment, so go through the native setter
	// and fire the event React listens for.
	if (fillAgency && AGENCY) {
		await page.evaluate((agency) => {
			const setter = Object.getOwnPropertyDescriptor(
				window.HTMLInputElement.prototype,
				'value',
			).set
			for (const input of document.querySelectorAll('input')) {
				if (!/0x/.test(input.placeholder ?? '')) continue
				setter.call(input, agency)
				input.dispatchEvent(new Event('input', { bubbles: true }))
			}
		}, AGENCY)
		// Give the on-chain hasRoles read time to resolve and repaint the badge.
		await page.waitForTimeout(4_000)
		await page.evaluate(() => {
			for (const d of document.querySelectorAll('details')) d.open = true
		})
	} else if (fillAgency) {
		console.warn('\n  WARNING: AGENCY_ADDRESS not set — the delegation badge will read "enter an address above"')
	}

	// The demo page has to stay in view long enough to render the hash-verified creative and
	// clock a qualifying view, or the screenshot shows an empty slot.
	if (dwellMs) {
		await page.waitForSelector('img[data-proofads-campaign]', { timeout: 25_000 }).catch(() => {
			console.warn('\n  WARNING: no ad rendered — is a campaign active on hero?')
		})
		await page.waitForTimeout(dwellMs)
		await page.evaluate(() => {
			for (const d of document.querySelectorAll('details')) d.open = true
		})
	} else {
		await page.waitForTimeout(1_200)
	}

	await page.screenshot({ path: join(OUT, file), fullPage: true })
	console.log('✓', file)
}

await browser.close()
console.log(`\nWrote ${PAGES.length} screenshots to docs/evidence/`)
