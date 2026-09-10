/**
 * Drives a real Chromium at the demo publisher page and proves the loop closes in a browser:
 * the SDK reads the active campaign from chain, verifies the creative bytes against the
 * on-chain hash, renders it, measures ten qualifying seconds, and posts events to the collector.
 */
import { chromium } from 'playwright'

const WEB_URL = process.env.WEB_URL ?? 'http://127.0.0.1:3000'
const API_URL = process.env.API_URL ?? 'http://127.0.0.1:8787'
const CAMPAIGN_ID = process.env.CAMPAIGN_ID ?? '1'

const before = await (await fetch(`${API_URL}/campaigns/${CAMPAIGN_ID}/summary`)).json()

const browser = await chromium.launch({
	args: ['--no-sandbox'],
	// Use the Chromium already present in the environment rather than downloading one.
	...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
})
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const consoleErrors = []
// Favicon 404s are noise from the harness, not from the ad path.
page.on('console', (m) => {
	if (m.type() !== 'error') return
	const text = m.text()
	if (/favicon/i.test(text)) return
	consoleErrors.push(text)
})
page.on('requestfailed', (r) => {
	if (/favicon/i.test(r.url())) return
	consoleErrors.push(`request failed: ${r.url()}`)
})

await page.goto(`${WEB_URL}/demo-publisher`, { waitUntil: 'networkidle' })
await page.waitForSelector('img[data-proofads-campaign]', { timeout: 20_000 })

const rendered = await page.$eval('img[data-proofads-campaign]', (el) => ({
	campaign: el.dataset.proofadsCampaign,
	src: el.getAttribute('src'),
	width: el.clientWidth,
}))

// Keep the slot in view and the tab foregrounded for longer than the qualifying window.
await page.waitForTimeout(14_000)
await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
await page.waitForTimeout(1_500)

await page.screenshot({ path: process.env.SCREENSHOT ?? 'demo-publisher.png', fullPage: false })
await browser.close()

const after = await (await fetch(`${API_URL}/campaigns/${CAMPAIGN_ID}/summary`)).json()

const result = {
	renderedCampaign: rendered.campaign,
	creativeSrc: rendered.src,
	renderedWidthPx: rendered.width,
	eventsBefore: before.totalEvents,
	eventsAfter: after.totalEvents,
	qualifyingBefore: before.qualifyingEvents,
	qualifyingAfter: after.qualifyingEvents,
	sessionsAfter: after.distinctSessions,
	consoleErrors,
}
console.log(JSON.stringify(result, null, 2))

const ok =
	rendered.campaign === CAMPAIGN_ID &&
	after.totalEvents > before.totalEvents &&
	after.qualifyingEvents > before.qualifyingEvents &&
	consoleErrors.length === 0
console.log(ok ? 'BROWSER-CHECK: PASS' : 'BROWSER-CHECK: FAIL')
process.exit(ok ? 0 : 1)
