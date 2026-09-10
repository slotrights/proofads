// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";

import {RegistryRolesLib} from "@ensdomains/contracts-v2/registry/libraries/RegistryRolesLib.sol";
import {IRegistry} from "@ensdomains/contracts-v2/registry/interfaces/IRegistry.sol";
import {LabelStore} from "@ensdomains/contracts-v2/utils/LabelStore.sol";
import {IContractNamer} from "@ensdomains/contracts-v2/reverse-registrar/interfaces/IContractNamer.sol";

import {AdInventoryRegistry} from "../src/AdInventoryRegistry.sol";
import {ENSv2AuthorizationAdapter} from "../src/ENSv2AuthorizationAdapter.sol";
import {IAdInventoryRegistry} from "../src/interfaces/IAdInventoryRegistry.sol";
import {ProofAdsMarket} from "../src/ProofAdsMarket.sol";
import {ProofAdsSettlementReceiver} from "../src/ProofAdsSettlementReceiver.sol";
import {MockUSDC} from "../src/testing/MockUSDC.sol";

/// @notice Shared setup: a real ENSv2 `LabelStore` + `AdInventoryRegistry` with two ad slots,
///         plus the ProofAds marketplace wired to a mock forwarder.
abstract contract ProofAdsFixture is Test {
    // Actors
    address internal deployer = makeAddr("deployer");
    address internal publisher = makeAddr("publisher");
    address internal agency = makeAddr("agency");
    address internal advertiserA = makeAddr("advertiserA");
    address internal advertiserB = makeAddr("advertiserB");
    address internal stranger = makeAddr("stranger");
    address internal forwarder = makeAddr("keystoneForwarder");

    // ENSv2
    LabelStore internal labelStore;
    AdInventoryRegistry internal registry;

    // ProofAds
    MockUSDC internal usdc;
    ENSv2AuthorizationAdapter internal adapter;
    ProofAdsMarket internal market;
    ProofAdsSettlementReceiver internal receiver;

    bytes32 internal HERO = keccak256(bytes("hero"));
    bytes32 internal SIDEBAR = keccak256(bytes("sidebar"));
    bytes32 internal UNKNOWN = keccak256(bytes("footer"));

    uint64 internal slotExpiry;

    /// @dev Cached so a `vm.prank` is never consumed by an incidental view call.
    uint256 internal ROLE_SELL;

    /// @dev Roles the slot owner receives on the slot's own resource at registration time.
    uint256 internal constant OWNER_SLOT_ROLES = RegistryRolesLib.ROLE_SET_RESOLVER
        | RegistryRolesLib.ROLE_SET_RESOLVER_ADMIN | RegistryRolesLib.ROLE_SET_SUBREGISTRY
        | RegistryRolesLib.ROLE_SET_SUBREGISTRY_ADMIN | RegistryRolesLib.ROLE_RENEW
        | RegistryRolesLib.ROLE_RENEW_ADMIN | RegistryRolesLib.ROLE_UNREGISTER
        | RegistryRolesLib.ROLE_UNREGISTER_ADMIN;

    function _deployProofAds(bool devMode) internal {
        vm.warp(1_757_000_000); // a fixed, realistic timestamp
        slotExpiry = uint64(block.timestamp + 365 days);

        labelStore = new LabelStore(IContractNamer(address(0)));
        registry = new AdInventoryRegistry(labelStore, publisher);
        ROLE_SELL = registry.ROLE_SELL_SLOT();

        vm.startPrank(publisher);
        registry.register("hero", publisher, IRegistry(address(0)), address(0), OWNER_SLOT_ROLES, slotExpiry);
        registry.register("sidebar", publisher, IRegistry(address(0)), address(0), OWNER_SLOT_ROLES, slotExpiry);
        vm.stopPrank();

        usdc = new MockUSDC();
        vm.startPrank(deployer);
        adapter = new ENSv2AuthorizationAdapter(IAdInventoryRegistry(address(registry)));
        market = new ProofAdsMarket(usdc, adapter, devMode);
        receiver = new ProofAdsSettlementReceiver(forwarder, market);
        market.setSettlementReceiver(address(receiver));
        vm.stopPrank();

        usdc.mint(advertiserA, 1_000 * 1e6);
        usdc.mint(advertiserB, 1_000 * 1e6);
    }

    function _grantSell(address to, bytes32 labelhash) internal {
        vm.prank(publisher);
        registry.grantRoles(uint256(labelhash), ROLE_SELL, to);
    }

    function _revokeSell(address from, bytes32 labelhash) internal {
        vm.prank(publisher);
        registry.revokeRoles(uint256(labelhash), ROLE_SELL, from);
    }

    function _bid(address who, uint256 listingId, uint96 unitPrice, bytes32 creativeHash)
        internal
        returns (uint256 bidIndex)
    {
        ProofAdsMarket.Listing memory listing = market.getListing(listingId);
        uint256 escrow = uint256(unitPrice) * listing.targetUnits;
        vm.startPrank(who);
        usdc.approve(address(market), escrow);
        bidIndex = market.placeBid(listingId, unitPrice, creativeHash, "https://cdn.example/creative.png");
        vm.stopPrank();
    }

    /// @dev Deliver a report the way the Chainlink Forwarder does: call `onReport` on the
    ///      receiver, from the forwarder address, with an abi-encoded payload.
    function _deliverReport(uint256 campaignId, uint32 cumulativeUnits, bytes32 digest) internal {
        bytes memory report = abi.encode(campaignId, cumulativeUnits, digest, uint64(0), uint64(block.timestamp));
        vm.prank(forwarder);
        receiver.onReport(hex"", report);
    }
}
