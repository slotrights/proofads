// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ProofAdsFixture} from "./ProofAdsFixture.sol";
import {ProofAdsMarket} from "../src/ProofAdsMarket.sol";

/// @notice The full marketplace acceptance matrix: ENS-gated listing, escrowed bidding,
///         authorization re-check at finalization, refunds, and cumulative settlement.
contract ProofAdsMarketTest is ProofAdsFixture {
    uint32 internal constant TARGET = 2;
    uint96 internal constant RESERVE = 0.10e6; // 0.10 USDC
    uint32 internal constant DURATION = 1200; // 20 minutes

    bytes32 internal constant CREATIVE_A = keccak256("creative-a");
    bytes32 internal constant CREATIVE_B = keccak256("creative-b");
    bytes32 internal constant DIGEST = keccak256("batch-1");

    uint64 internal auctionEnd;

    function setUp() public {
        _deployProofAds(false);
        auctionEnd = uint64(block.timestamp + 180);
    }

    // ────────────────────────────────────────────────────────────────────
    // Listing: ENS authorization
    // ────────────────────────────────────────────────────────────────────

    function _createHeroListing(address seller) internal returns (uint256) {
        vm.prank(seller);
        return market.createListing(
            HERO, ProofAdsMarket.MetricType.VIEW_10_SECONDS, TARGET, RESERVE, auctionEnd, DURATION
        );
    }

    function test_PublisherCanListItsOwnSlot() public {
        uint256 listingId = _createHeroListing(publisher);
        ProofAdsMarket.Listing memory listing = market.getListing(listingId);
        assertEq(listing.seller, publisher);
        assertEq(listing.publisherAtCreation, publisher);
        assertEq(uint8(listing.status), uint8(ProofAdsMarket.ListingStatus.OPEN));
    }

    function test_AuthorizedAgencyCanListHero() public {
        _grantSell(agency, HERO);
        uint256 listingId = _createHeroListing(agency);
        assertEq(market.getListing(listingId).seller, agency);
        // Publisher is still derived from ENS, not from the seller.
        assertEq(market.getListing(listingId).publisherAtCreation, publisher);
    }

    function test_UnauthorizedAgencyCannotListHero() public {
        vm.prank(agency);
        vm.expectRevert(abi.encodeWithSelector(ProofAdsMarket.SellerNotAuthorized.selector, HERO, agency));
        market.createListing(
            HERO, ProofAdsMarket.MetricType.VIEW_10_SECONDS, TARGET, RESERVE, auctionEnd, DURATION
        );
    }

    function test_AgencyAuthorizedForHeroCannotListSidebar() public {
        _grantSell(agency, HERO);
        vm.prank(agency);
        vm.expectRevert(abi.encodeWithSelector(ProofAdsMarket.SellerNotAuthorized.selector, SIDEBAR, agency));
        market.createListing(
            SIDEBAR, ProofAdsMarket.MetricType.VIEW_10_SECONDS, TARGET, RESERVE, auctionEnd, DURATION
        );
    }

    function test_RevokedAgencyCannotListHero() public {
        _grantSell(agency, HERO);
        _revokeSell(agency, HERO);
        vm.prank(agency);
        vm.expectRevert(abi.encodeWithSelector(ProofAdsMarket.SellerNotAuthorized.selector, HERO, agency));
        market.createListing(
            HERO, ProofAdsMarket.MetricType.VIEW_10_SECONDS, TARGET, RESERVE, auctionEnd, DURATION
        );
    }

    function test_CannotListUnknownSlot() public {
        vm.prank(publisher);
        vm.expectRevert(abi.encodeWithSelector(ProofAdsMarket.SellerNotAuthorized.selector, UNKNOWN, publisher));
        market.createListing(
            UNKNOWN, ProofAdsMarket.MetricType.VIEW_10_SECONDS, TARGET, RESERVE, auctionEnd, DURATION
        );
    }

    // ────────────────────────────────────────────────────────────────────
    // Listing: parameter validation
    // ────────────────────────────────────────────────────────────────────

    function test_RejectsZeroTarget() public {
        vm.prank(publisher);
        vm.expectRevert(abi.encodeWithSelector(ProofAdsMarket.InvalidTarget.selector, uint32(0)));
        market.createListing(HERO, ProofAdsMarket.MetricType.VIEW_10_SECONDS, 0, RESERVE, auctionEnd, DURATION);
    }

    function test_RejectsTargetAboveCeiling() public {
        vm.prank(publisher);
        vm.expectRevert(abi.encodeWithSelector(ProofAdsMarket.InvalidTarget.selector, uint32(10_001)));
        market.createListing(
            HERO, ProofAdsMarket.MetricType.VIEW_10_SECONDS, 10_001, RESERVE, auctionEnd, DURATION
        );
    }

    function test_RejectsZeroReserve() public {
        vm.prank(publisher);
        vm.expectRevert(ProofAdsMarket.InvalidReserve.selector);
        market.createListing(HERO, ProofAdsMarket.MetricType.VIEW_10_SECONDS, TARGET, 0, auctionEnd, DURATION);
    }

    function test_RejectsAuctionEndInThePast() public {
        uint64 past = uint64(block.timestamp);
        vm.prank(publisher);
        vm.expectRevert(abi.encodeWithSelector(ProofAdsMarket.InvalidAuctionEnd.selector, past));
        market.createListing(HERO, ProofAdsMarket.MetricType.VIEW_10_SECONDS, TARGET, RESERVE, past, DURATION);
    }

    function test_RejectsShortDuration() public {
        vm.prank(publisher);
        vm.expectRevert(abi.encodeWithSelector(ProofAdsMarket.InvalidDuration.selector, uint32(59)));
        market.createListing(HERO, ProofAdsMarket.MetricType.VIEW_10_SECONDS, TARGET, RESERVE, auctionEnd, 59);
    }

    function test_OneOpenListingPerSlot() public {
        uint256 first = _createHeroListing(publisher);
        vm.prank(publisher);
        vm.expectRevert(abi.encodeWithSelector(ProofAdsMarket.SlotAlreadyListed.selector, HERO, first));
        market.createListing(
            HERO, ProofAdsMarket.MetricType.VIEW_10_SECONDS, TARGET, RESERVE, auctionEnd, DURATION
        );
    }

    function test_CannotListSlotWithActiveCampaign() public {
        uint256 listingId = _createHeroListing(publisher);
        _bid(advertiserA, listingId, RESERVE, CREATIVE_A);
        vm.warp(auctionEnd);
        market.finalizeAuction(listingId);

        vm.prank(publisher);
        vm.expectRevert(abi.encodeWithSelector(ProofAdsMarket.SlotHasActiveCampaign.selector, HERO, uint256(1)));
        market.createListing(
            HERO,
            ProofAdsMarket.MetricType.VIEW_10_SECONDS,
            TARGET,
            RESERVE,
            uint64(block.timestamp + 100),
            DURATION
        );
    }

    // ────────────────────────────────────────────────────────────────────
    // Bidding
    // ────────────────────────────────────────────────────────────────────

    function test_BidEscrowsRealUsdc() public {
        uint256 listingId = _createHeroListing(publisher);
        uint256 before = usdc.balanceOf(advertiserA);
        _bid(advertiserA, listingId, 0.15e6, CREATIVE_A);

        assertEq(usdc.balanceOf(advertiserA), before - 0.30e6, "0.15 x 2 units escrowed");
        assertEq(usdc.balanceOf(address(market)), 0.30e6);
        ProofAdsMarket.Bid[] memory bids = market.getBids(listingId);
        assertEq(bids.length, 1);
        assertEq(bids[0].bidder, advertiserA);
        assertEq(bids[0].unitPrice, 0.15e6);
        assertEq(bids[0].escrow, 0.30e6);
        assertEq(bids[0].creativeHash, CREATIVE_A);
    }

    function test_MultipleBidsAreRecorded() public {
        uint256 listingId = _createHeroListing(publisher);
        _bid(advertiserA, listingId, 0.15e6, CREATIVE_A);
        _bid(advertiserB, listingId, 0.20e6, CREATIVE_B);
        assertEq(market.getBidCount(listingId), 2);
        assertEq(usdc.balanceOf(address(market)), 0.30e6 + 0.40e6);
    }

    function test_BidBelowReserveRejected() public {
        uint256 listingId = _createHeroListing(publisher);
        vm.startPrank(advertiserA);
        usdc.approve(address(market), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(ProofAdsMarket.BidBelowReserve.selector, uint96(0.09e6), RESERVE));
        market.placeBid(listingId, 0.09e6, CREATIVE_A, "https://cdn.example/a.png");
        vm.stopPrank();
    }

    function test_LateBidRejected() public {
        uint256 listingId = _createHeroListing(publisher);
        vm.warp(auctionEnd);
        vm.startPrank(advertiserA);
        usdc.approve(address(market), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(ProofAdsMarket.AuctionEnded.selector, listingId));
        market.placeBid(listingId, RESERVE, CREATIVE_A, "https://cdn.example/a.png");
        vm.stopPrank();
    }

    function test_OneBidPerAddress() public {
        uint256 listingId = _createHeroListing(publisher);
        _bid(advertiserA, listingId, 0.15e6, CREATIVE_A);
        vm.startPrank(advertiserA);
        usdc.approve(address(market), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(ProofAdsMarket.AlreadyBid.selector, listingId, advertiserA));
        market.placeBid(listingId, 0.25e6, CREATIVE_A, "https://cdn.example/a.png");
        vm.stopPrank();
    }

    function test_EmptyCreativeRejected() public {
        uint256 listingId = _createHeroListing(publisher);
        vm.startPrank(advertiserA);
        usdc.approve(address(market), type(uint256).max);
        vm.expectRevert(ProofAdsMarket.InvalidCreative.selector);
        market.placeBid(listingId, RESERVE, bytes32(0), "https://cdn.example/a.png");
        vm.expectRevert(ProofAdsMarket.InvalidCreative.selector);
        market.placeBid(listingId, RESERVE, CREATIVE_A, "");
        vm.stopPrank();
    }

    // ────────────────────────────────────────────────────────────────────
    // Finalization
    // ────────────────────────────────────────────────────────────────────

    function test_CannotFinalizeBeforeAuctionEnd() public {
        uint256 listingId = _createHeroListing(publisher);
        _bid(advertiserA, listingId, RESERVE, CREATIVE_A);
        vm.expectRevert(abi.encodeWithSelector(ProofAdsMarket.AuctionNotEnded.selector, listingId));
        market.finalizeAuction(listingId);
    }

    function test_HighestBidWins() public {
        uint256 listingId = _createHeroListing(publisher);
        _bid(advertiserA, listingId, 0.15e6, CREATIVE_A);
        _bid(advertiserB, listingId, 0.20e6, CREATIVE_B);
        vm.warp(auctionEnd);
        uint256 campaignId = market.finalizeAuction(listingId);

        ProofAdsMarket.Campaign memory campaign = market.getCampaign(campaignId);
        assertEq(campaign.advertiser, advertiserB);
        assertEq(campaign.unitPrice, 0.20e6);
        assertEq(campaign.totalBudget, 0.40e6);
        assertEq(campaign.publisher, publisher);
        assertEq(campaign.creativeHash, CREATIVE_B);
        assertEq(campaign.deadline, uint64(block.timestamp) + DURATION);
        assertEq(uint8(campaign.status), uint8(ProofAdsMarket.CampaignStatus.ACTIVE));
        assertEq(market.activeCampaignForSlot(HERO), campaignId);
    }

    function test_TieGoesToEarliestBid() public {
        uint256 listingId = _createHeroListing(publisher);
        _bid(advertiserA, listingId, 0.20e6, CREATIVE_A);
        _bid(advertiserB, listingId, 0.20e6, CREATIVE_B);
        vm.warp(auctionEnd);
        uint256 campaignId = market.finalizeAuction(listingId);
        assertEq(market.getCampaign(campaignId).advertiser, advertiserA);
    }

    function test_RevokedSellerCancelsListingAndRefundsEveryone() public {
        _grantSell(agency, HERO);
        uint256 listingId = _createHeroListing(agency);
        _bid(advertiserA, listingId, 0.15e6, CREATIVE_A);
        _bid(advertiserB, listingId, 0.20e6, CREATIVE_B);

        _revokeSell(agency, HERO); // publisher changes its mind mid-auction

        vm.warp(auctionEnd);
        uint256 campaignId = market.finalizeAuction(listingId);
        assertEq(campaignId, 0);
        assertEq(uint8(market.getListing(listingId).status), uint8(ProofAdsMarket.ListingStatus.CANCELLED));
        assertEq(market.activeCampaignForSlot(HERO), 0);

        uint256 aBefore = usdc.balanceOf(advertiserA);
        uint256 bBefore = usdc.balanceOf(advertiserB);
        vm.prank(advertiserA);
        market.withdrawBid(listingId);
        vm.prank(advertiserB);
        market.withdrawBid(listingId);
        assertEq(usdc.balanceOf(advertiserA), aBefore + 0.30e6);
        assertEq(usdc.balanceOf(advertiserB), bBefore + 0.40e6);
        assertEq(usdc.balanceOf(address(market)), 0);
    }

    function test_NoBidsCancelsListingAndFreesSlot() public {
        uint256 listingId = _createHeroListing(publisher);
        vm.warp(auctionEnd);
        assertEq(market.finalizeAuction(listingId), 0);
        assertEq(uint8(market.getListing(listingId).status), uint8(ProofAdsMarket.ListingStatus.CANCELLED));
        assertEq(market.openListingForSlot(HERO), 0);
    }

    function test_CannotFinalizeTwice() public {
        uint256 listingId = _createHeroListing(publisher);
        _bid(advertiserA, listingId, RESERVE, CREATIVE_A);
        vm.warp(auctionEnd);
        market.finalizeAuction(listingId);
        vm.expectRevert(abi.encodeWithSelector(ProofAdsMarket.ListingNotOpen.selector, listingId));
        market.finalizeAuction(listingId);
    }

    // ────────────────────────────────────────────────────────────────────
    // Refunds
    // ────────────────────────────────────────────────────────────────────

    function _finalizedListing() internal returns (uint256 listingId, uint256 campaignId) {
        listingId = _createHeroListing(publisher);
        _bid(advertiserA, listingId, 0.15e6, CREATIVE_A);
        _bid(advertiserB, listingId, 0.20e6, CREATIVE_B);
        vm.warp(auctionEnd);
        campaignId = market.finalizeAuction(listingId);
    }

    function test_LoserGetsFullRefund() public {
        (uint256 listingId,) = _finalizedListing();
        uint256 before = usdc.balanceOf(advertiserA);
        vm.prank(advertiserA);
        uint256 amount = market.withdrawBid(listingId);
        assertEq(amount, 0.30e6);
        assertEq(usdc.balanceOf(advertiserA), before + 0.30e6);
    }

    function test_LoserCannotWithdrawTwice() public {
        (uint256 listingId,) = _finalizedListing();
        vm.prank(advertiserA);
        market.withdrawBid(listingId);
        vm.prank(advertiserA);
        vm.expectRevert(ProofAdsMarket.NothingToWithdraw.selector);
        market.withdrawBid(listingId);
    }

    function test_WinnerCannotWithdraw() public {
        (uint256 listingId,) = _finalizedListing();
        vm.prank(advertiserB);
        vm.expectRevert(ProofAdsMarket.WinnerCannotWithdraw.selector);
        market.withdrawBid(listingId);
    }

    function test_NonBidderCannotWithdraw() public {
        (uint256 listingId,) = _finalizedListing();
        vm.prank(stranger);
        vm.expectRevert(ProofAdsMarket.NothingToWithdraw.selector);
        market.withdrawBid(listingId);
    }

    function test_WinnerEscrowStaysLocked() public {
        (uint256 listingId,) = _finalizedListing();
        vm.prank(advertiserA);
        market.withdrawBid(listingId);
        assertEq(usdc.balanceOf(address(market)), 0.40e6, "only the winner's budget remains");
    }

    // ────────────────────────────────────────────────────────────────────
    // Settlement
    // ────────────────────────────────────────────────────────────────────

    function test_OnlySettlementReceiverMaySettle() public {
        (, uint256 campaignId) = _finalizedListing();
        vm.prank(deployer);
        vm.expectRevert(abi.encodeWithSelector(ProofAdsMarket.NotSettlementReceiver.selector, deployer));
        market.applyDelivery(campaignId, 1, DIGEST);
    }

    function test_DevPathIsCompiledOutWhenDevModeFalse() public {
        (, uint256 campaignId) = _finalizedListing();
        vm.prank(deployer);
        vm.expectRevert(ProofAdsMarket.DevModeDisabled.selector);
        market.devApplyDelivery(campaignId, 1, DIGEST);
    }

    function test_ReceiverRejectsCallsNotFromForwarder() public {
        (, uint256 campaignId) = _finalizedListing();
        bytes memory report = abi.encode(campaignId, uint32(1), DIGEST, uint64(0), uint64(block.timestamp));
        vm.prank(stranger);
        vm.expectRevert();
        receiver.onReport(hex"", report);
    }

    function test_PartialDeliveryPaysProRata() public {
        (, uint256 campaignId) = _finalizedListing();
        uint256 before = usdc.balanceOf(publisher);

        _deliverReport(campaignId, 1, DIGEST);

        assertEq(usdc.balanceOf(publisher), before + 0.20e6, "1 verified unit x 0.20");
        ProofAdsMarket.Campaign memory campaign = market.getCampaign(campaignId);
        assertEq(campaign.verifiedUnits, 1);
        assertEq(campaign.paidAmount, 0.20e6);
        assertEq(uint8(campaign.status), uint8(ProofAdsMarket.CampaignStatus.ACTIVE));
    }

    function test_ReplayingTheSameReportPaysZero() public {
        (, uint256 campaignId) = _finalizedListing();
        _deliverReport(campaignId, 1, DIGEST);
        uint256 mid = usdc.balanceOf(publisher);
        _deliverReport(campaignId, 1, DIGEST);
        assertEq(usdc.balanceOf(publisher), mid, "idempotent");
        assertEq(market.getCampaign(campaignId).paidAmount, 0.20e6);
    }

    function test_DecreasingReportFromANewBatchReverts() public {
        (, uint256 campaignId) = _finalizedListing();
        _deliverReport(campaignId, 2, DIGEST);
        // The campaign closed at target, so a new, stale report is rejected outright.
        vm.expectRevert();
        _deliverReport(campaignId, 1, keccak256("stale-batch"));
    }

    function test_DecreasingReportRevertsWhileActive() public {
        uint256 listingId = _createHeroListing(publisher);
        _bid(advertiserA, listingId, 0.20e6, CREATIVE_A);
        vm.warp(auctionEnd);
        uint256 campaignId = market.finalizeAuction(listingId);

        _deliverReport(campaignId, 1, DIGEST);
        // A *different* batch reporting a lower cumulative total is a protocol error, not a replay.
        bytes memory report =
            abi.encode(campaignId, uint32(0), keccak256("batch-2"), uint64(0), uint64(block.timestamp));
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(ProofAdsMarket.NonMonotonicReport.selector, uint32(0), uint32(1)));
        receiver.onReport(hex"", report);
    }

    function test_ReplayIsIgnoredEvenWhenTheReportWouldOtherwiseBeRejected() public {
        (, uint256 campaignId) = _finalizedListing();
        _deliverReport(campaignId, 1, DIGEST);
        // Same batch digest, nonsense figure: recognised as already applied and ignored outright,
        // so ordering and retries can never double-pay.
        uint256 before = usdc.balanceOf(publisher);
        _deliverReport(campaignId, 0, DIGEST);
        assertEq(usdc.balanceOf(publisher), before);
        assertEq(market.getCampaign(campaignId).verifiedUnits, 1);
        assertTrue(market.batchApplied(campaignId, DIGEST));
    }

    function test_TwoDistinctBatchesEachCountOnce() public {
        (, uint256 campaignId) = _finalizedListing();
        uint256 before = usdc.balanceOf(publisher);
        _deliverReport(campaignId, 1, keccak256("batch-a"));
        _deliverReport(campaignId, 1, keccak256("batch-a")); // retry
        _deliverReport(campaignId, 2, keccak256("batch-b"));
        _deliverReport(campaignId, 2, keccak256("batch-b")); // retry
        assertEq(usdc.balanceOf(publisher) - before, 0.40e6);
        assertEq(market.getCampaign(campaignId).verifiedUnits, TARGET);
    }

    function test_VerifiedUnitsOfMatchesTheCampaign() public {
        (, uint256 campaignId) = _finalizedListing();
        assertEq(market.verifiedUnitsOf(campaignId), 0);
        _deliverReport(campaignId, 1, DIGEST);
        assertEq(market.verifiedUnitsOf(campaignId), 1);
        assertEq(market.verifiedUnitsOf(campaignId), market.getCampaign(campaignId).verifiedUnits);
    }

    function test_IncrementalDeliveryPaysOnlyTheDelta() public {
        (, uint256 campaignId) = _finalizedListing();
        uint256 before = usdc.balanceOf(publisher);
        _deliverReport(campaignId, 1, DIGEST);
        _deliverReport(campaignId, 2, keccak256("batch-2"));
        assertEq(usdc.balanceOf(publisher), before + 0.40e6);
        assertEq(market.getCampaign(campaignId).paidAmount, 0.40e6);
    }

    function test_OverTargetIsCappedAndClosesCampaign() public {
        (, uint256 campaignId) = _finalizedListing();
        uint256 before = usdc.balanceOf(publisher);
        _deliverReport(campaignId, 99, DIGEST);

        assertEq(usdc.balanceOf(publisher), before + 0.40e6, "capped at target x unitPrice");
        ProofAdsMarket.Campaign memory campaign = market.getCampaign(campaignId);
        assertEq(campaign.verifiedUnits, TARGET);
        assertEq(uint8(campaign.status), uint8(ProofAdsMarket.CampaignStatus.CLOSED));
        assertEq(market.activeCampaignForSlot(HERO), 0, "slot is free again");
    }

    function test_NewReportOnAClosedCampaignReverts() public {
        (, uint256 campaignId) = _finalizedListing();
        _deliverReport(campaignId, 2, DIGEST);
        // A batch the campaign has never seen, arriving after it closed.
        vm.expectRevert();
        _deliverReport(campaignId, 2, keccak256("late-batch"));
    }

    function test_RetryingAnAppliedBatchAfterCloseIsANoOp() public {
        (, uint256 campaignId) = _finalizedListing();
        _deliverReport(campaignId, 2, DIGEST);
        uint256 before = usdc.balanceOf(publisher);
        _deliverReport(campaignId, 2, DIGEST); // the Forwarder retrying must not revert
        assertEq(usdc.balanceOf(publisher), before);
    }

    // ────────────────────────────────────────────────────────────────────
    // Closing
    // ────────────────────────────────────────────────────────────────────

    function test_CannotCloseBeforeDeadline() public {
        (, uint256 campaignId) = _finalizedListing();
        uint64 deadline = market.getCampaign(campaignId).deadline;
        vm.expectRevert(abi.encodeWithSelector(ProofAdsMarket.DeadlineNotReached.selector, deadline));
        market.closeCampaign(campaignId);
    }

    function test_CloseRefundsTheUndeliveredRemainder() public {
        (, uint256 campaignId) = _finalizedListing();
        _deliverReport(campaignId, 1, DIGEST); // half delivered

        uint256 before = usdc.balanceOf(advertiserB);
        vm.warp(market.getCampaign(campaignId).deadline);
        uint256 refund = market.closeCampaign(campaignId);

        assertEq(refund, 0.20e6);
        assertEq(usdc.balanceOf(advertiserB), before + 0.20e6);
        assertEq(uint8(market.getCampaign(campaignId).status), uint8(ProofAdsMarket.CampaignStatus.CLOSED));
        assertEq(market.activeCampaignForSlot(HERO), 0);
    }

    function test_CloseWithNoDeliveryRefundsEverything() public {
        (, uint256 campaignId) = _finalizedListing();
        uint256 before = usdc.balanceOf(advertiserB);
        vm.warp(market.getCampaign(campaignId).deadline);
        market.closeCampaign(campaignId);
        assertEq(usdc.balanceOf(advertiserB), before + 0.40e6);
    }

    function test_CannotCloseTwice() public {
        (, uint256 campaignId) = _finalizedListing();
        vm.warp(market.getCampaign(campaignId).deadline);
        market.closeCampaign(campaignId);
        vm.expectRevert(abi.encodeWithSelector(ProofAdsMarket.CampaignNotActive.selector, campaignId));
        market.closeCampaign(campaignId);
    }

    function test_AnyoneMayClose() public {
        (, uint256 campaignId) = _finalizedListing();
        vm.warp(market.getCampaign(campaignId).deadline);
        vm.prank(stranger);
        market.closeCampaign(campaignId);
        assertEq(uint8(market.getCampaign(campaignId).status), uint8(ProofAdsMarket.CampaignStatus.CLOSED));
    }

    // ────────────────────────────────────────────────────────────────────
    // Invariants (explicit assertions, per the MVP rule: no fuzz harness)
    // ────────────────────────────────────────────────────────────────────

    function test_Invariant_PaidNeverExceedsBudget() public {
        (, uint256 campaignId) = _finalizedListing();
        _deliverReport(campaignId, 1, DIGEST);
        ProofAdsMarket.Campaign memory c = market.getCampaign(campaignId);
        assertLe(c.paidAmount, c.totalBudget);
        _deliverReport(campaignId, 500, DIGEST);
        c = market.getCampaign(campaignId);
        assertLe(c.paidAmount, c.totalBudget);
    }

    function test_Invariant_PaidPlusRefundEqualsBudget() public {
        (, uint256 campaignId) = _finalizedListing();
        _deliverReport(campaignId, 1, DIGEST);
        vm.warp(market.getCampaign(campaignId).deadline);
        uint256 refund = market.closeCampaign(campaignId);
        ProofAdsMarket.Campaign memory c = market.getCampaign(campaignId);
        assertEq(c.paidAmount + refund, c.totalBudget);
    }

    function test_Invariant_ContractBalanceCoversLiabilities() public {
        (uint256 listingId, uint256 campaignId) = _finalizedListing();
        assertEq(usdc.balanceOf(address(market)), market.outstandingLiabilities());

        vm.prank(advertiserA);
        market.withdrawBid(listingId);
        assertEq(usdc.balanceOf(address(market)), market.outstandingLiabilities());

        _deliverReport(campaignId, 1, DIGEST);
        assertEq(usdc.balanceOf(address(market)), market.outstandingLiabilities());

        vm.warp(market.getCampaign(campaignId).deadline);
        market.closeCampaign(campaignId);
        assertEq(usdc.balanceOf(address(market)), 0);
        assertEq(market.outstandingLiabilities(), 0);
    }

    // ────────────────────────────────────────────────────────────────────
    // Wiring
    // ────────────────────────────────────────────────────────────────────

    function test_SettlementReceiverIsSetOnce() public {
        vm.prank(deployer);
        vm.expectRevert(ProofAdsMarket.ReceiverAlreadySet.selector);
        market.setSettlementReceiver(address(0xdead));
    }

    function test_NonOwnerCannotSetReceiver() public {
        vm.prank(stranger);
        vm.expectRevert(ProofAdsMarket.NotOwner.selector);
        market.setSettlementReceiver(address(0xdead));
    }

    function test_ReceiverKnowsItsForwarderAndMarket() public view {
        assertEq(receiver.getForwarderAddress(), forwarder);
        assertEq(address(receiver.MARKET()), address(market));
    }
}
