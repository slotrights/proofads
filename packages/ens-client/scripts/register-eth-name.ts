/**
 * Registers one `.eth` name on the ENSv2 Sepolia beta, using the real commit/reveal flow.
 *
 * ENSv2's `ETHRegistrar` is paid in ENS's own MockUSDC on Sepolia (permissionless `mint`), NOT
 * in Circle USDC — ProofAds uses Circle USDC for advertising settlement and MockUSDC only to buy
 * this test name.
 *
 *   PUBLISHER_PRIVATE_KEY=0x… SEPOLIA_RPC_URL=… pnpm --filter @proofads/ens-client register-name proofads-pub
 *
 * ABI fragments below are transcribed from
 * `contracts-v2/contracts/src/registrar/ETHRegistrar.sol` @ commit 48b3e2d.
 */
import { createPublicClient, createWalletClient, http, parseAbi, zeroAddress, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'

const ETH_REGISTRAR = (process.env.ENS_ETH_REGISTRAR ??
	'0xa88553F454b77203B0D036A05c894d555EAAa2Cc') as `0x${string}`
const MOCK_USDC = (process.env.ENS_MOCK_USDC ??
	'0x768F42455A2D082E23ceeF7d51e5787C82d67a39') as `0x${string}`

const registrarAbi = parseAbi([
	'function commit(bytes32 commitment) external',
	'function register(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, address paymentToken, bytes32 referrer) external returns (uint256)',
	'function makeCommitment(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, bytes32 referrer) external pure returns (bytes32)',
	'function isAvailable(string label) external view returns (bool)',
	'function getRegisterPrice(string label, uint64 duration, address paymentToken) external view returns (uint256 base, uint256 premium)',
	'function MIN_COMMITMENT_AGE() external view returns (uint64)',
])

const erc20Abi = parseAbi([
	'function mint(address to, uint256 amount) external',
	'function approve(address spender, uint256 amount) external returns (bool)',
	'function balanceOf(address account) external view returns (uint256)',
])

const label = process.argv[2] ?? 'proofads-pub'
const durationSeconds = BigInt(process.env.DURATION_SECONDS ?? 365 * 24 * 3600)

const account = privateKeyToAccount(
	(process.env.PUBLISHER_PRIVATE_KEY ??
		(() => {
			throw new Error('PUBLISHER_PRIVATE_KEY is required')
		})()) as Hex,
)
const rpcUrl =
	process.env.SEPOLIA_RPC_URL ??
	(() => {
		throw new Error('SEPOLIA_RPC_URL is required')
	})()

const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) })
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) })

const secret = (process.env.COMMIT_SECRET ??
	`0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`) as Hex

async function wait(hash: Hex, what: string) {
	const receipt = await publicClient.waitForTransactionReceipt({ hash })
	console.log(`${what}: ${hash} (${receipt.status})`)
	if (receipt.status !== 'success') throw new Error(`${what} reverted`)
}

async function main() {
	const available = await publicClient.readContract({
		address: ETH_REGISTRAR, abi: registrarAbi, functionName: 'isAvailable', args: [label],
	})
	if (!available) throw new Error(`${label}.eth is not available on ENSv2 Sepolia`)

	const [base, premium] = await publicClient.readContract({
		address: ETH_REGISTRAR, abi: registrarAbi, functionName: 'getRegisterPrice',
		args: [label, durationSeconds, MOCK_USDC],
	})
	const price = base + premium
	console.log(`price for ${label}.eth: ${price} (MockUSDC units)`)

	const balance = await publicClient.readContract({
		address: MOCK_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [account.address],
	})
	if (balance < price) {
		// ENS's Sepolia MockUSDC mints permissionlessly; this is test money, not Circle USDC.
		await wait(
			await walletClient.writeContract({
				address: MOCK_USDC, abi: erc20Abi, functionName: 'mint',
				args: [account.address, price * 2n],
			}),
			'mint MockUSDC',
		)
	}
	await wait(
		await walletClient.writeContract({
			address: MOCK_USDC, abi: erc20Abi, functionName: 'approve', args: [ETH_REGISTRAR, price],
		}),
		'approve registrar',
	)

	const commitment = await publicClient.readContract({
		address: ETH_REGISTRAR, abi: registrarAbi, functionName: 'makeCommitment',
		args: [label, account.address, secret, zeroAddress, zeroAddress, durationSeconds, `0x${'00'.repeat(32)}`],
	})
	console.log(`secret: ${secret}`)
	await wait(
		await walletClient.writeContract({
			address: ETH_REGISTRAR, abi: registrarAbi, functionName: 'commit', args: [commitment],
		}),
		'commit',
	)

	const minAge = await publicClient.readContract({
		address: ETH_REGISTRAR, abi: registrarAbi, functionName: 'MIN_COMMITMENT_AGE',
	})
	const waitMs = Number(minAge) * 1000 + 15_000
	console.log(`waiting ${waitMs / 1000}s for the commitment to age…`)
	await new Promise((r) => setTimeout(r, waitMs))

	await wait(
		await walletClient.writeContract({
			address: ETH_REGISTRAR, abi: registrarAbi, functionName: 'register',
			args: [
				label, account.address, secret, zeroAddress, zeroAddress, durationSeconds, MOCK_USDC,
				`0x${'00'.repeat(32)}`,
			],
		}),
		'register',
	)
	console.log(`${label}.eth registered to ${account.address}`)
	console.log('Next: forge script script/SetupInventorySepolia.s.sol')
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
