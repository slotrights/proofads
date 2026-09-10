// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ReceiverTemplate} from "./chainlink/ReceiverTemplate.sol";
import {ProofAdsMarket} from "./ProofAdsMarket.sol";

/// @title ProofAdsSettlementReceiver
/// @notice The only door through which delivery reports enter ProofAds.
///
/// @dev Extends the official Chainlink `ReceiverTemplate`, so `onReport` is rejected unless
///      `msg.sender` is the KeystoneForwarder configured at construction, and (once
///      `setExpectedAuthor` / `setExpectedWorkflowName` are configured) unless the report was
///      produced by our workflow. The decoded aggregate is forwarded to `ProofAdsMarket`,
///      which accepts it only from this address.
///
///      Report layout, produced by the confidential workflow's `usingTheDons()` step:
///        abi.encode(uint256 campaignId, uint32 cumulativeVerifiedUnits,
///                   bytes32 batchDigest, uint64 windowStart, uint64 windowEnd)
///
///      Note what is *not* in the report: no session ids, no timestamps per view, no
///      visibility traces, no API token. Those never leave the enclave.
contract ProofAdsSettlementReceiver is ReceiverTemplate {
    /// @notice The marketplace this receiver settles into.
    ProofAdsMarket public immutable MARKET;

    event SettlementReportReceived(
        uint256 indexed campaignId,
        uint32 cumulativeVerifiedUnits,
        bytes32 batchDigest,
        uint64 windowStart,
        uint64 windowEnd
    );

    error ZeroAddress();

    /// @param forwarder The Chainlink KeystoneForwarder for this chain.
    /// @param market The ProofAds marketplace.
    constructor(address forwarder, ProofAdsMarket market) ReceiverTemplate(forwarder) {
        if (address(market) == address(0)) revert ZeroAddress();
        MARKET = market;
    }

    /// @inheritdoc ReceiverTemplate
    function _processReport(bytes calldata report) internal override {
        (
            uint256 campaignId,
            uint32 cumulativeVerifiedUnits,
            bytes32 batchDigest,
            uint64 windowStart,
            uint64 windowEnd
        ) = abi.decode(report, (uint256, uint32, bytes32, uint64, uint64));

        emit SettlementReportReceived(campaignId, cumulativeVerifiedUnits, batchDigest, windowStart, windowEnd);
        MARKET.applyDelivery(campaignId, cumulativeVerifiedUnits, batchDigest);
    }
}
