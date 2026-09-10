// The narrow slice of ProofAdsMarket the workflow reads. Mirrors
// contracts/out/ProofAdsMarket.sol/ProofAdsMarket.json.
export const ProofAdsMarketABI = [
  {
    type: 'function',
    name: 'verifiedUnitsOf',
    inputs: [{ name: 'campaignId', type: 'uint256', internalType: 'uint256' }],
    outputs: [{ name: '', type: 'uint32', internalType: 'uint32' }],
    stateMutability: 'view',
  },
] as const
