// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ProofAdsFixture} from "./ProofAdsFixture.sol";
import {ProofAdsMarket} from "../src/ProofAdsMarket.sol";
import {MockUSDC} from "../src/testing/MockUSDC.sol";
import {CostlyUSDC} from "../src/testing/CostlyUSDC.sol";

/// @notice Regression suite for ADR-017: the gas the Chainlink Forwarder forwards into
///         `onReport` must cover a settlement against a *real* settlement token.
///
/// @dev The rest of the contract suite, and the whole local end-to-end run, settle against
///      `MockUSDC`, whose transfer is a fraction of the cost of Circle's USDC. That gap is why a
///      fully green test suite still produced a Sepolia settlement that reverted `OutOfGas`
///      inside `USDC.transfer` — and, because the Forwarder catches receiver reverts and records
///      them as `ReportProcessed(result: false)`, produced a successful-looking transaction that
///      moved no money.
///
///      These tests pin two things:
///        1. the worst-case settlement fits inside the budget the workflow actually requests, and
///        2. a starved budget fails cleanly — no partial payment, and crucially the batch digest
///           is *not* consumed, so the report can simply be retried.
contract SettlementGasBudgetTest is ProofAdsFixture {
    /// @dev Must equal `settlementGasLimit` in
    ///      `workflows/proofads-delivery/my-workflow/config.staging.json` and `config.production.json`.
    ///      If you change one, change all three.
    uint256 internal constant SETTLEMENT_GAS_LIMIT = 900_000;

    uint32 internal constant TARGET = 2;
    uint96 internal constant RESERVE = 0.10e6;
    uint32 internal constant DURATION = 1200;
    bytes32 internal constant CREATIVE_A = keccak256("creative-a");
    bytes32 internal constant DIGEST_1 = keccak256("batch-1");
    bytes32 internal constant DIGEST_2 = keccak256("batch-2");

    uint64 internal auctionEnd;

    function setUp() public {
        _deployProofAds(false);
    }

    /// @dev The settlement currency for this suite costs what a real one costs.
    function _deployUsdc() internal override returns (MockUSDC) {
        return new CostlyUSDC();
    }

    function _freshCampaign(uint96 unitPrice) internal returns (uint256 campaignId) {
        auctionEnd = uint64(block.timestamp + 180);
        vm.prank(publisher);
        uint256 listingId = market.createListing(
            HERO, ProofAdsMarket.MetricType.VIEW_10_SECONDS, TARGET, RESERVE, auctionEnd, DURATION
        );
        _bid(advertiserA, listingId, unitPrice, CREATIVE_A);
        vm.warp(auctionEnd);
        campaignId = market.finalizeAuction(listingId);
    }

    function _report(uint256 campaignId, uint32 cumulative, bytes32 digest)
        internal
        view
        returns (bytes memory)
    {
        return abi.encode(campaignId, cumulative, digest, uint64(0), uint64(block.timestamp));
    }

    // ────────────────────────────────────────────────────────────────────

    /// @notice The most expensive settlement there is — the report that completes the campaign,
    ///         paying the publisher, refunding the advertiser and closing the campaign in one
    ///         call — must fit inside the budget the workflow requests.
    function test_WorstCaseSettlementFitsTheConfiguredGasLimit() public {
        uint256 campaignId = _freshCampaign(0.20e6);
        bytes memory report = _report(campaignId, TARGET, DIGEST_1);

        vm.prank(forwarder);
        uint256 before = gasleft();
        receiver.onReport{gas: SETTLEMENT_GAS_LIMIT}(hex"", report);
        uint256 used = before - gasleft();

        emit log_named_uint("worst-case settlement gas (costly token)", used);
        assertLt(used, SETTLEMENT_GAS_LIMIT, "settlement no longer fits settlementGasLimit");

        ProofAdsMarket.Campaign memory campaign = market.getCampaign(campaignId);
        assertEq(uint8(campaign.status), uint8(ProofAdsMarket.CampaignStatus.CLOSED));
        assertEq(campaign.verifiedUnits, TARGET);
    }

    /// @notice A partial settlement — publisher payout, campaign stays open — also fits, with the
    ///         measured cost reported so a regression is visible in the log rather than only at
    ///         the moment the assertion trips.
    function test_PartialSettlementFitsTheConfiguredGasLimit() public {
        uint256 campaignId = _freshCampaign(0.20e6);
        bytes memory report = _report(campaignId, 1, DIGEST_1);

        vm.prank(forwarder);
        uint256 before = gasleft();
        receiver.onReport{gas: SETTLEMENT_GAS_LIMIT}(hex"", report);
        uint256 used = before - gasleft();

        emit log_named_uint("partial settlement gas (costly token)", used);
        assertLt(used, SETTLEMENT_GAS_LIMIT);
        assertEq(market.getCampaign(campaignId).verifiedUnits, 1);
    }

    /// @notice The failure that actually happened on Sepolia, pinned. Half the gas a settlement
    ///         needs is enough for a `MockUSDC` transfer and not enough for a real one.
    ///
    ///         What matters is not only that it fails, but *how*: nothing is paid, no campaign
    ///         state moves, and the batch digest is not marked applied — so the identical report
    ///         can be retried once the budget is raised. That is what made the Sepolia recovery a
    ///         re-run rather than a lost batch.
    function test_StarvedGasBudgetFailsCleanlyAndLeavesTheBatchRetryable() public {
        // Calibrate against a real settlement rather than a magic number: settle one campaign to
        // completion at full budget, measure it, then starve an identical one by half.
        uint256 measured;
        {
            uint256 warmup = _freshCampaign(0.20e6);
            vm.prank(forwarder);
            uint256 before = gasleft();
            receiver.onReport{gas: SETTLEMENT_GAS_LIMIT}(hex"", _report(warmup, TARGET, DIGEST_1));
            measured = before - gasleft();
            // Completing the campaign closes it and frees the slot for the next listing.
            assertEq(uint8(market.getCampaign(warmup).status), uint8(ProofAdsMarket.CampaignStatus.CLOSED));
        }

        uint256 campaignId = _freshCampaign(0.20e6);
        uint256 publisherBefore = usdc.balanceOf(publisher);
        uint256 marketBefore = usdc.balanceOf(address(market));

        vm.prank(forwarder);
        (bool ok,) = address(receiver).call{gas: measured / 2}(
            abi.encodeCall(receiver.onReport, (hex"", _report(campaignId, 1, DIGEST_2)))
        );

        assertFalse(ok, "a starved settlement must fail, not half-succeed");
        assertEq(usdc.balanceOf(publisher), publisherBefore, "no partial payment");
        assertEq(usdc.balanceOf(address(market)), marketBefore, "escrow untouched");

        ProofAdsMarket.Campaign memory campaign = market.getCampaign(campaignId);
        assertEq(campaign.verifiedUnits, 0, "no delivery recorded");
        assertEq(campaign.paidAmount, 0);
        assertEq(uint8(campaign.status), uint8(ProofAdsMarket.CampaignStatus.ACTIVE), "still settleable");
        assertFalse(market.batchApplied(campaignId, DIGEST_2), "digest must stay unconsumed so the batch can be retried");

        // And the retry, at the proper budget, settles exactly as if the first attempt never happened.
        vm.prank(forwarder);
        receiver.onReport{gas: SETTLEMENT_GAS_LIMIT}(hex"", _report(campaignId, 1, DIGEST_2));
        assertEq(usdc.balanceOf(publisher), publisherBefore + 0.20e6, "retry pays exactly once");
        assertEq(market.getCampaign(campaignId).verifiedUnits, 1);
        assertTrue(market.batchApplied(campaignId, DIGEST_2));
    }
}
