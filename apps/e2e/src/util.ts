import { formatUnits } from 'viem'

let failures = 0
let checks = 0

export function step(title: string): void {
	console.log(`\n\x1b[1m── ${title}\x1b[0m`)
}

export function info(message: string): void {
	console.log(`   ${message}`)
}

export function check(label: string, actual: unknown, expected: unknown): void {
	checks += 1
	const a = typeof actual === 'bigint' ? actual.toString() : JSON.stringify(actual)
	const e = typeof expected === 'bigint' ? expected.toString() : JSON.stringify(expected)
	if (a === e) {
		console.log(`   \x1b[32m✓\x1b[0m ${label} = ${a}`)
	} else {
		failures += 1
		console.log(`   \x1b[31m✗\x1b[0m ${label}: expected ${e}, got ${a}`)
	}
}

export function checkTrue(label: string, actual: boolean): void {
	check(label, actual, true)
}

export function usdc(amount: bigint): string {
	return `${formatUnits(amount, 6)} USDC`
}

export function summarize(): void {
	console.log(
		`\n${failures === 0 ? '\x1b[32m' : '\x1b[31m'}${checks - failures}/${checks} assertions passed\x1b[0m`,
	)
	if (failures > 0) process.exit(1)
}

export async function expectRevert(label: string, fn: () => Promise<unknown>, contains?: string) {
	checks += 1
	try {
		await fn()
		failures += 1
		console.log(`   \x1b[31m✗\x1b[0m ${label}: expected a revert, but the call succeeded`)
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		if (contains && !message.includes(contains)) {
			failures += 1
			console.log(`   \x1b[31m✗\x1b[0m ${label}: reverted, but not with ${contains}`)
			console.log(`      ${message.split('\n')[0]}`)
		} else {
			console.log(`   \x1b[32m✓\x1b[0m ${label} reverted${contains ? ` with ${contains}` : ''}`)
		}
	}
}
