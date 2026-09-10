// Mirror of contracts/out/ProofAdsSettlementReceiver.sol/ProofAdsSettlementReceiver.json.
// Regenerate with: node scripts/export-abis.mjs && node scripts/sync-workflow-abi.mjs
export const ProofAdsSettlementReceiverABI = [
  {
    type: 'function',
    name: 'onReport',
    inputs: [
      { name: 'metadata', type: 'bytes', internalType: 'bytes' },
      { name: 'report', type: 'bytes', internalType: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getForwarderAddress',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
] as const
