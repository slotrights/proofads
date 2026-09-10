// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice ENSv2 beta addresses on Ethereum Sepolia.
///
/// @dev Source: https://docs.ens.domains/learn/deployments (fetched 2026-09-09).
///      `ensdomains/contracts-v2`'s own `contracts/deployments/sepolia/*.json` disagrees with the
///      docs page for several entries — see docs/PROTOCOL_RESEARCH.md. The scripts below assert
///      that each address has bytecode before using it, and every address can be overridden by
///      an environment variable so a corrected set can be supplied without a code change.
library SepoliaEnsV2 {
    address internal constant VERIFIABLE_FACTORY = 0x10dC6333CDFe1FCEf624c6e0a8221b91804Cd7ef;
    address internal constant USER_REGISTRY_IMPL = 0x624a25d67B59D587752EbEc8DdeD8827dAe52050;
    address internal constant PERMISSIONED_RESOLVER_IMPL = 0x9EAe5C2730a7dD16BDD1DeE6421a1B91e3B0365e;
    address internal constant LABEL_STORE = 0x532CD0CC4AC0793d838F71A67d29B2D790D18777;
    address internal constant ROOT_REGISTRY = 0x8115186E8f2E0B0281e86ab91f0f48Ba90364354;
    address internal constant ETH_REGISTRY = 0xBDC85dD5b15D7ecb354cd7cb6f2c50b4f2c4F0E2;
    address internal constant ETH_REGISTRAR = 0xa88553F454b77203B0D036A05c894d555EAAa2Cc;
    address internal constant UNIVERSAL_RESOLVER_V2 = 0x4A1817d13E9cF196f471725176355C1234b63C70;
    address internal constant MOCK_USDC = 0x768F42455A2D082E23ceeF7d51e5787C82d67a39;
    address internal constant PUBLIC_RESOLVER_V2 = 0xe7B9A25607E02da8145E4eB1836CA539e53F11f7;

    /// @notice Circle's official Sepolia USDC, 6 decimals. Not ENS's MockUSDC.
    address internal constant CIRCLE_USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    /// @notice Chainlink KeystoneForwarder on Sepolia (per the CRE starter templates).
    address internal constant KEYSTONE_FORWARDER = 0x15fC6ae953E024d975e77382eEeC56A9101f9F88;
}
