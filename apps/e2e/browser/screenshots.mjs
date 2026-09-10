/** Captures each screen for the README and the demo, from the running app. */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const WEB_URL = process.env.WEB_URL ?? 'http://127.0.0.1:3000'
const OUT = process.env.OUT ?? 'docs/evidence'
const CAMPAIGN_ID = process.env.CAMPAIGN_ID ?? '1'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
	args: ['--no-sandbox'],
	...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
})
const page = await browser.newPage({ viewport: { width: 1380, height: 1000 }, deviceScaleFactor: 2 })

const shots = [
	['/', 'ui-inventory.png'],
	['/publisher', 'ui-publisher.png'],
	['/advertiser', 'ui-advertiser.png'],
	[`/campaign/${CAMPAIGN_ID}`, 'ui-campaign.png'],
	['/demo-publisher', 'ui-demo-publisher.png'],
]

for (const [path, file] of shots) {
	await page.goto(`${WEB_URL}${path}`, { waitUntil: 'networkidle' })
	await page.waitForTimeout(3500)
	// Expand every Technical details block so the screenshots show the raw state.
	await page.$$eval('details.tech', (list) => list.forEach((d) => d.setAttribute('open', '')))
	await page.waitForTimeout(400)
	await page.screenshot({ path: `${OUT}/${file}`, fullPage: true })
	console.log(`captured ${file}`)
}
await browser.close()
