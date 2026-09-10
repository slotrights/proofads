// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ENSv2AuthorizationAdapter} from "./ENSv2AuthorizationAdapter.sol";

/// @title ProofAdsMarket
/// @notice Escrowed, delivery-metered advertising marketplace over ENSv2 ad slots.
///
/// Lifecycle:
///   1. A seller authorized by ENSv2 opens a listing on a slot.
///   2. Advertisers bid; each bid escrows `unitPrice * targetUnits` of USDC in this contract.
///   3. After the auction ends anyone finalizes: highest unit price wins, ties go to the
///      earliest bid. Seller authorization is re-read from ENS at this moment; if it was
///      revoked in the meantime the listing is cancelled and every bid becomes withdrawable.
///   4. Losing bidders withdraw their full escrow.
///   5. Delivery reports arrive from the Chainlink CRE settlement receiver and release the
///      publisher's share proportionally and idempotently.
///   6. After the deadline anyone closes the campaign and the undelivered remainder is
///      refunded to the advertiser.
contract ProofAdsMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;

    ////////////////////////////////////////////////////////////////////////
    // Types
    ////////////////////////////////////////////////////////////////////////

    enum MetricType {
        VIEW_10_SECONDS,
        SELFIE_CHECKED_VIEW_10_SECONDS
    }

    enum ListingStatus {
        NONE,
        OPEN,
        FINALIZED,
        CANCELLED
    }

    enum CampaignStatus {
        NONE,
        ACTIVE,
        CLOSED
    }

    struct Listing {
        bytes32 labelhash;
        address seller;
        address publisherAtCreation;
        MetricType metric;
        uint32 targetUnits;
        uint96 reserveUnitPrice;
        uint64 auctionEnd;
        uint32 campaignDuration;
        ListingStatus status;
        uint256 campaignId;
    }

    struct Bid {
        address bidder;
        uint96 unitPrice;
        uint256 escrow;
        bytes32 creativeHash;
        string creativeURI;
        bool withdrawn;
    }

    struct Campaign {
        uint256 listingId;
        bytes32 labelhash;
        address publisher;
        address seller;
        address advertiser;
        MetricType metric;
        uint96 unitPrice;
        uint32 targetUnits;
        uint32 verifiedUnits;
        uint256 totalBudget;
        uint256 paidAmount;
        uint64 startTime;
        uint64 deadline;
        bytes32 creativeHash;
        string creativeURI;
        CampaignStatus status;
    }

    ////////////////////////////////////////////////////////////////////////
    // Constants, immutables and storage
    ////////////////////////////////////////////////////////////////////////

    /// @notice Sanity ceiling on a single campaign's target, keeping `unitPrice * target` small.
    uint32 public constant MAX_TARGET_UNITS = 10_000;

    /// @notice Shortest campaign duration accepted, in seconds.
    uint32 public constant MIN_CAMPAIGN_DURATION = 60;

    /// @notice The settlement currency. Circle USDC (6 decimals) on Sepolia and mainnet.
    IERC20 public immutable USDC;

    /// @notice The only source of truth for slot ownership and selling rights.
    ENSv2AuthorizationAdapter public immutable ADAPTER;

    /// @notice When true, `devApplyDelivery` is callable by the owner. Always false in the
    ///         deployment used for judging; it exists so the marketplace can be tested before
    ///         the Chainlink receiver exists.
    bool public immutable DEV_MODE;

    /// @notice Deployer. May set the settlement receiver exactly once.
    address public immutable OWNER;

    /// @notice The `ProofAdsSettlementReceiver` that is allowed to report delivery.
    address public settlementReceiver;

    uint256 public listingCount;
    uint256 public campaignCount;

    mapping(uint256 listingId => Listing) private _listings;
    mapping(uint256 listingId => Bid[]) private _bids;
    mapping(uint256 listingId => mapping(address bidder => bool)) public hasBid;
    mapping(uint256 campaignId => Campaign) private _campaigns;

    /// @notice The single OPEN listing per slot, if any. Zero means none.
    mapping(bytes32 labelhash => uint256 listingId) public openListingForSlot;

    /// @notice The single ACTIVE campaign per slot, if any. Zero means none.
    mapping(bytes32 labelhash => uint256 campaignId) public activeCampaignForSlot;

    /// @notice Which measurement batches have already been applied to which campaign.
    /// @dev Replay protection that does not depend on ordering: the same batch can be reported
    ///      twice, or two batches can be reported out of order, and neither double-pays.
    mapping(uint256 campaignId => mapping(bytes32 batchDigest => bool)) public batchApplied;

    ////////////////////////////////////////////////////////////////////////
    // Events
    ////////////////////////////////////////////////////////////////////////

    event ListingCreated(
        uint256 indexed listingId,
        bytes32 indexed labelhash,
        address indexed seller,
        address publisher,
        MetricType metric,
        uint32 targetUnits,
        uint96 reserveUnitPrice,
        uint64 auctionEnd,
        uint32 campaignDuration
    );
    event BidPlaced(
        uint256 indexed listingId,
        uint256 indexed bidIndex,
        address indexed bidder,
        uint96 unitPrice,
        uint256 escrow,
        bytes32 creativeHash,
        string creativeURI
    );
    event CampaignActivated(
        uint256 indexed campaignId,
        uint256 indexed listingId,
        bytes32 indexed labelhash,
        address publisher,
        address advertiser,
        uint96 unitPrice,
        uint32 targetUnits,
        uint256 totalBudget,
        uint64 deadline,
        bytes32 creativeHash
    );
    event ListingCancelled(uint256 indexed listingId, bytes32 indexed labelhash, string reason);
    event BidWithdrawn(uint256 indexed listingId, uint256 indexed bidIndex, address indexed bidder, uint256 amount);
    event DeliveryApplied(
        uint256 indexed campaignId,
        uint32 reportedCumulativeUnits,
        uint32 effectiveUnits,
        uint256 payoutDelta,
        bytes32 batchDigest
    );
    event DeliveryAlreadyApplied(uint256 indexed campaignId, bytes32 batchDigest);
    event CampaignClosed(uint256 indexed campaignId, uint256 refundAmount, uint256 paidAmount);
    event SettlementReceiverSet(address receiver);

    ////////////////////////////////////////////////////////////////////////
    // Errors
    ////////////////////////////////////////////////////////////////////////

    error ZeroAddress();
    error NotOwner();
    error ReceiverAlreadySet();
    error SellerNotAuthorized(bytes32 labelhash, address seller);
    error SlotAlreadyListed(bytes32 labelhash, uint256 listingId);
    error SlotHasActiveCampaign(bytes32 labelhash, uint256 campaignId);
    error InvalidTarget(uint32 targetUnits);
    error InvalidReserve();
    error InvalidAuctionEnd(uint64 auctionEnd);
    error InvalidDuration(uint32 duration);
    error ListingNotOpen(uint256 listingId);
    error AuctionEnded(uint256 listingId);
    error AuctionNotEnded(uint256 listingId);
    error BidBelowReserve(uint96 unitPrice, uint96 reserve);
    error AlreadyBid(uint256 listingId, address bidder);
    error InvalidCreative();
    error NothingToWithdraw();
    error WinnerCannotWithdraw();
    error NotSettlementReceiver(address caller);
    error CampaignNotActive(uint256 campaignId);
    error NonMonotonicReport(uint32 reported, uint32 current);
    error DeadlineNotReached(uint64 deadline);
    error DevModeDisabled();

    ////////////////////////////////////////////////////////////////////////
    // Construction
    ////////////////////////////////////////////////////////////////////////

    constructor(IERC20 usdc, ENSv2AuthorizationAdapter adapter, bool devMode) {
        if (address(usdc) == address(0) || address(adapter) == address(0)) revert ZeroAddress();
        USDC = usdc;
        ADAPTER = adapter;
        DEV_MODE = devMode;
        OWNER = msg.sender;
    }

    /// @notice Wire the Chainlink settlement receiver. One-way, owner only.
    function setSettlementReceiver(address receiver) external {
        if (msg.sender != OWNER) revert NotOwner();
        if (settlementReceiver != address(0)) revert ReceiverAlreadySet();
        if (receiver == address(0)) revert ZeroAddress();
        settlementReceiver = receiver;
        emit SettlementReceiverSet(receiver);
    }

    ////////////////////////////////////////////////////////////////////////
    // Selling
    ////////////////////////////////////////////////////////////////////////

    /// @notice Offer an ENSv2 ad slot for sale.
    /// @dev The publisher is read from ENS, never from the caller. The caller must hold
    ///      `ROLE_SELL_SLOT` on the slot (or be its owner) at this instant.
    function createListing(
        bytes32 labelhash,
        MetricType metric,
        uint32 targetUnits,
        uint96 reserveUnitPrice,
        uint64 auctionEnd,
        uint32 campaignDuration
    ) external returns (uint256 listingId) {
        if (targetUnits == 0 || targetUnits > MAX_TARGET_UNITS) revert InvalidTarget(targetUnits);
        if (reserveUnitPrice == 0) revert InvalidReserve();
        if (auctionEnd <= block.timestamp) revert InvalidAuctionEnd(auctionEnd);
        if (campaignDuration < MIN_CAMPAIGN_DURATION) revert InvalidDuration(campaignDuration);

        uint256 existing = openListingForSlot[labelhash];
        if (existing != 0 && _listings[existing].status == ListingStatus.OPEN) {
            revert SlotAlreadyListed(labelhash, existing);
        }
        uint256 active = activeCampaignForSlot[labelhash];
        if (active != 0) revert SlotHasActiveCampaign(labelhash, active);

        // ENS is the authority. Both calls read live chain state.
        if (!ADAPTER.isAuthorizedSeller(labelhash, msg.sender)) {
            revert SellerNotAuthorized(labelhash, msg.sender);
        }
        address publisher = ADAPTER.getPublisher(labelhash);

        listingId = ++listingCount;
        _listings[listingId] = Listing({
            labelhash: labelhash,
            seller: msg.sender,
            publisherAtCreation: publisher,
            metric: metric,
            targetUnits: targetUnits,
            reserveUnitPrice: reserveUnitPrice,
            auctionEnd: auctionEnd,
            campaignDuration: campaignDuration,
            status: ListingStatus.OPEN,
            campaignId: 0
        });
        openListingForSlot[labelhash] = listingId;

        emit ListingCreated(
            listingId,
            labelhash,
            msg.sender,
            publisher,
            metric,
            targetUnits,
            reserveUnitPrice,
            auctionEnd,
            campaignDuration
        );
    }

    ////////////////////////////////////////////////////////////////////////
    // Bidding
    ////////////////////////////////////////////////////////////////////////

    /// @notice Bid `unitPrice` per verified unit and escrow the whole budget up front.
    function placeBid(uint256 listingId, uint96 unitPrice, bytes32 creativeHash, string calldata creativeURI)
        external
        nonReentrant
        returns (uint256 bidIndex)
    {
        Listing storage listing = _listings[listingId];
        if (listing.status != ListingStatus.OPEN) revert ListingNotOpen(listingId);
        if (block.timestamp >= listing.auctionEnd) revert AuctionEnded(listingId);
        if (unitPrice < listing.reserveUnitPrice) revert BidBelowReserve(unitPrice, listing.reserveUnitPrice);
        if (hasBid[listingId][msg.sender]) revert AlreadyBid(listingId, msg.sender);
        if (creativeHash == bytes32(0) || bytes(creativeURI).length == 0) revert InvalidCreative();

        uint256 escrow = uint256(unitPrice) * uint256(listing.targetUnits);
        hasBid[listingId][msg.sender] = true;
        bidIndex = _bids[listingId].length;
        _bids[listingId].push(
            Bid({
                bidder: msg.sender,
                unitPrice: unitPrice,
                escrow: escrow,
                creativeHash: creativeHash,
                creativeURI: creativeURI,
                withdrawn: false
            })
        );

        USDC.safeTransferFrom(msg.sender, address(this), escrow);
        emit BidPlaced(listingId, bidIndex, msg.sender, unitPrice, escrow, creativeHash, creativeURI);
    }

    /// @notice Close the auction and, if the seller is still authorized, start the campaign.
    /// @dev Callable by anyone once `auctionEnd` has passed.
    function finalizeAuction(uint256 listingId) external nonReentrant returns (uint256 campaignId) {
        Listing storage listing = _listings[listingId];
        if (listing.status != ListingStatus.OPEN) revert ListingNotOpen(listingId);
        if (block.timestamp < listing.auctionEnd) revert AuctionNotEnded(listingId);

        Bid[] storage bids = _bids[listingId];
        if (bids.length == 0) {
            listing.status = ListingStatus.CANCELLED;
            openListingForSlot[listing.labelhash] = 0;
            emit ListingCancelled(listingId, listing.labelhash, "NO_BIDS");
            return 0;
        }

        // ENS is re-read here, not trusted from listing time (ADR-004).
        if (!ADAPTER.isAuthorizedSeller(listing.labelhash, listing.seller)) {
            listing.status = ListingStatus.CANCELLED;
            openListingForSlot[listing.labelhash] = 0;
            emit ListingCancelled(listingId, listing.labelhash, "SELLER_REVOKED");
            return 0;
        }

        uint256 winner = 0;
        for (uint256 i = 1; i < bids.length; ++i) {
            if (bids[i].unitPrice > bids[winner].unitPrice) winner = i;
        }
        Bid storage winningBid = bids[winner];

        // The payout address is the current ENS owner, read now.
        address publisher = ADAPTER.getPublisher(listing.labelhash);

        campaignId = ++campaignCount;
        uint64 startTime = uint64(block.timestamp);
        _campaigns[campaignId] = Campaign({
            listingId: listingId,
            labelhash: listing.labelhash,
            publisher: publisher,
            seller: listing.seller,
            advertiser: winningBid.bidder,
            metric: listing.metric,
            unitPrice: winningBid.unitPrice,
            targetUnits: listing.targetUnits,
            verifiedUnits: 0,
            totalBudget: winningBid.escrow,
            paidAmount: 0,
            startTime: startTime,
            deadline: startTime + uint64(listing.campaignDuration),
            creativeHash: winningBid.creativeHash,
            creativeURI: winningBid.creativeURI,
            status: CampaignStatus.ACTIVE
        });

        listing.status = ListingStatus.FINALIZED;
        listing.campaignId = campaignId;
        openListingForSlot[listing.labelhash] = 0;
        activeCampaignForSlot[listing.labelhash] = campaignId;

        emit CampaignActivated(
            campaignId,
            listingId,
            listing.labelhash,
            publisher,
            winningBid.bidder,
            winningBid.unitPrice,
            listing.targetUnits,
            winningBid.escrow,
            startTime + uint64(listing.campaignDuration),
            winningBid.creativeHash
        );
    }

    /// @notice Reclaim escrow. Available to losing bidders after finalization and to every
    ///         bidder on a cancelled listing.
    function withdrawBid(uint256 listingId) external nonReentrant returns (uint256 amount) {
        Listing storage listing = _listings[listingId];
        if (listing.status != ListingStatus.FINALIZED && listing.status != ListingStatus.CANCELLED) {
            revert ListingNotOpen(listingId);
        }

        address winner = listing.status == ListingStatus.FINALIZED
            ? _campaigns[listing.campaignId].advertiser
            : address(0);

        Bid[] storage bids = _bids[listingId];
        uint256 index = type(uint256).max;
        for (uint256 i = 0; i < bids.length; ++i) {
            if (bids[i].bidder == msg.sender) {
                index = i;
                break;
            }
        }
        if (index == type(uint256).max) revert NothingToWithdraw();
        if (msg.sender == winner) revert WinnerCannotWithdraw();

        Bid storage bid = bids[index];
        if (bid.withdrawn) revert NothingToWithdraw();
        bid.withdrawn = true;
        amount = bid.escrow;

        USDC.safeTransfer(msg.sender, amount);
        emit BidWithdrawn(listingId, index, msg.sender, amount);
    }

    ////////////////////////////////////////////////////////////////////////
    // Settlement
    ////////////////////////////////////////////////////////////////////////

    /// @notice Apply a cumulative delivery report produced by the Chainlink Confidential Workflow.
    /// @dev Idempotent and monotonic: the report carries a cumulative count, this function pays
    ///      only the difference. Replaying the same report pays zero.
    function applyDelivery(uint256 campaignId, uint32 cumulativeVerifiedUnits, bytes32 batchDigest)
        external
        nonReentrant
    {
        if (msg.sender != settlementReceiver) revert NotSettlementReceiver(msg.sender);
        _applyDelivery(campaignId, cumulativeVerifiedUnits, batchDigest);
    }

    /// @notice Test-only settlement path, compiled in only when `DEV_MODE` is true.
    function devApplyDelivery(uint256 campaignId, uint32 cumulativeVerifiedUnits, bytes32 batchDigest)
        external
        nonReentrant
    {
        if (!DEV_MODE) revert DevModeDisabled();
        if (msg.sender != OWNER) revert NotOwner();
        _applyDelivery(campaignId, cumulativeVerifiedUnits, batchDigest);
    }

    function _applyDelivery(uint256 campaignId, uint32 cumulativeVerifiedUnits, bytes32 batchDigest) private {
        // A batch counts once, whatever order reports arrive in and however often one is retried.
        // Checked before the status check so that a retry of an already-applied batch is a no-op
        // even after the campaign has closed — a retried delivery must never revert the
        // Forwarder's transaction.
        if (batchDigest != bytes32(0) && batchApplied[campaignId][batchDigest]) {
            emit DeliveryAlreadyApplied(campaignId, batchDigest);
            return;
        }

        Campaign storage campaign = _campaigns[campaignId];
        if (campaign.status != CampaignStatus.ACTIVE) revert CampaignNotActive(campaignId);

        if (cumulativeVerifiedUnits < campaign.verifiedUnits) {
            revert NonMonotonicReport(cumulativeVerifiedUnits, campaign.verifiedUnits);
        }
        if (batchDigest != bytes32(0)) batchApplied[campaignId][batchDigest] = true;

        uint32 effective =
            cumulativeVerifiedUnits > campaign.targetUnits ? campaign.targetUnits : cumulativeVerifiedUnits;
        uint256 owed = uint256(effective) * uint256(campaign.unitPrice);
        uint256 payoutDelta = owed - campaign.paidAmount;

        // Effects before interactions.
        campaign.verifiedUnits = effective;
        campaign.paidAmount = owed;

        address publisher = campaign.publisher;
        uint256 refund = 0;
        bool finished = effective == campaign.targetUnits;
        if (finished) {
            refund = campaign.totalBudget - owed; // zero by construction, kept explicit
            campaign.status = CampaignStatus.CLOSED;
            activeCampaignForSlot[campaign.labelhash] = 0;
        }

        if (payoutDelta > 0) USDC.safeTransfer(publisher, payoutDelta);
        emit DeliveryApplied(campaignId, cumulativeVerifiedUnits, effective, payoutDelta, batchDigest);

        if (finished) {
            if (refund > 0) USDC.safeTransfer(campaign.advertiser, refund);
            emit CampaignClosed(campaignId, refund, owed);
        }
    }

    /// @notice After the deadline, refund whatever was never delivered. Callable by anyone.
    function closeCampaign(uint256 campaignId) external nonReentrant returns (uint256 refund) {
        Campaign storage campaign = _campaigns[campaignId];
        if (campaign.status != CampaignStatus.ACTIVE) revert CampaignNotActive(campaignId);
        if (block.timestamp < campaign.deadline) revert DeadlineNotReached(campaign.deadline);

        refund = campaign.totalBudget - campaign.paidAmount;
        campaign.status = CampaignStatus.CLOSED;
        activeCampaignForSlot[campaign.labelhash] = 0;

        if (refund > 0) USDC.safeTransfer(campaign.advertiser, refund);
        emit CampaignClosed(campaignId, refund, campaign.paidAmount);
    }

    ////////////////////////////////////////////////////////////////////////
    // Views
    ////////////////////////////////////////////////////////////////////////

    function getListing(uint256 listingId) external view returns (Listing memory) {
        return _listings[listingId];
    }

    function getCampaign(uint256 campaignId) external view returns (Campaign memory) {
        return _campaigns[campaignId];
    }

    function getBids(uint256 listingId) external view returns (Bid[] memory) {
        return _bids[listingId];
    }

    function getBidCount(uint256 listingId) external view returns (uint256) {
        return _bids[listingId].length;
    }

    /// @notice Cumulative verified delivery for a campaign.
    /// @dev A narrow view so the Chainlink workflow can read the settled total straight from the
    ///      contract instead of being told it by the measurement collector. Cheap to bind, cheap
    ///      to decode.
    function verifiedUnitsOf(uint256 campaignId) external view returns (uint32) {
        return _campaigns[campaignId].verifiedUnits;
    }

    /// @notice Live authorization of a listing's seller, for UIs that must not cache permissions.
    function isListingSellerStillAuthorized(uint256 listingId) external view returns (bool) {
        Listing storage listing = _listings[listingId];
        if (listing.status == ListingStatus.NONE) return false;
        return ADAPTER.isAuthorizedSeller(listing.labelhash, listing.seller);
    }

    /// @notice Total escrow the contract still owes to bidders and advertisers.
    /// @dev Used by tests as a solvency invariant against `USDC.balanceOf(address(this))`.
    function outstandingLiabilities() external view returns (uint256 total) {
        for (uint256 listingId = 1; listingId <= listingCount; ++listingId) {
            Listing storage listing = _listings[listingId];
            address winner = listing.status == ListingStatus.FINALIZED
                ? _campaigns[listing.campaignId].advertiser
                : address(0);
            Bid[] storage bids = _bids[listingId];
            for (uint256 i = 0; i < bids.length; ++i) {
                if (bids[i].withdrawn) continue;
                if (bids[i].bidder == winner && listing.status == ListingStatus.FINALIZED) continue;
                total += bids[i].escrow;
            }
        }
        for (uint256 campaignId = 1; campaignId <= campaignCount; ++campaignId) {
            Campaign storage campaign = _campaigns[campaignId];
            if (campaign.status == CampaignStatus.ACTIVE) {
                total += campaign.totalBudget - campaign.paidAmount;
            }
        }
    }
}
