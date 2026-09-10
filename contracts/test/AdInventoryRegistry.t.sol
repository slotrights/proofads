// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IEnhancedAccessControl} from
    "@ensdomains/contracts-v2/access-control/interfaces/IEnhancedAccessControl.sol";
import {IPermissionedRegistry} from "@ensdomains/contracts-v2/registry/interfaces/IPermissionedRegistry.sol";

import {ENSv2AuthorizationAdapter} from "../src/ENSv2AuthorizationAdapter.sol";
import {ProofAdsFixture} from "./ProofAdsFixture.sol";

/// @notice Proves that ENSv2 Enhanced Access Control — not ProofAds bookkeeping — is what
///         decides who may sell an ad slot.
contract AdInventoryRegistryTest is ProofAdsFixture {
    function setUp() public {
        _deployProofAds(true);
    }

    // ── Ownership ───────────────────────────────────────────────────────

    function test_SlotsAreOwnedByPublisher() public view {
        assertEq(registry.getOwner(uint256(HERO)), publisher);
        assertEq(registry.getOwner(uint256(SIDEBAR)), publisher);
        assertEq(uint8(registry.getStatus(uint256(HERO))), uint8(IPermissionedRegistry.Status.REGISTERED));
    }

    function test_UnregisteredSlotHasNoOwner() public view {
        assertEq(registry.getOwner(uint256(UNKNOWN)), address(0));
    }

    function test_LabelStoreCanInvertLabelhash() public view {
        assertEq(labelStore.getLabel(uint256(HERO)), "hero");
        assertEq(labelStore.getLabel(uint256(SIDEBAR)), "sidebar");
    }

    // ── The role itself ─────────────────────────────────────────────────

    function test_RoleSellSlotOccupiesFreeNybbleTen() public view {
        assertEq(registry.ROLE_SELL_SLOT(), uint256(1) << 40);
        assertEq(registry.ROLE_SELL_SLOT_ADMIN(), uint256(1) << 168);
    }

    function test_PublisherIsAuthorizedByRootFallback() public view {
        // The publisher holds ALL_ROLES on ROOT_RESOURCE, and EAC ORs root roles into every
        // resource check, so it needs no per-slot grant.
        assertTrue(registry.isAuthorizedSeller(uint256(HERO), publisher));
        assertTrue(registry.isAuthorizedSeller(uint256(SIDEBAR), publisher));
    }

    function test_AgencyStartsUnauthorizedOnEverySlot() public view {
        assertFalse(registry.isAuthorizedSeller(uint256(HERO), agency));
        assertFalse(registry.isAuthorizedSeller(uint256(SIDEBAR), agency));
    }

    // ── Grant / revoke, the demo scenario ───────────────────────────────

    function test_GrantIsPerSlotNotPerPublisher() public {
        _grantSell(agency, HERO);
        assertTrue(registry.isAuthorizedSeller(uint256(HERO), agency), "hero granted");
        assertFalse(registry.isAuthorizedSeller(uint256(SIDEBAR), agency), "sidebar untouched");
    }

    function test_RevokeTakesEffectImmediately() public {
        _grantSell(agency, HERO);
        assertTrue(registry.isAuthorizedSeller(uint256(HERO), agency));
        _revokeSell(agency, HERO);
        assertFalse(registry.isAuthorizedSeller(uint256(HERO), agency));
    }

    function test_ReGrantAfterRevokeWorks() public {
        _grantSell(agency, HERO);
        _revokeSell(agency, HERO);
        _grantSell(agency, HERO);
        assertTrue(registry.isAuthorizedSeller(uint256(HERO), agency));
    }

    function test_HasRolesAgreesWithConvenienceView() public {
        _grantSell(agency, HERO);
        assertTrue(registry.hasRoles(uint256(HERO), ROLE_SELL, agency));
        assertEq(
            registry.isAuthorizedSeller(uint256(HERO), agency),
            registry.hasRoles(uint256(HERO), ROLE_SELL, agency)
        );
    }

    // ── Who may delegate ────────────────────────────────────────────────

    function test_NonAdminCannotGrantSellRole() public {
        vm.prank(stranger);
        vm.expectRevert();
        registry.grantRoles(uint256(HERO), ROLE_SELL, agency);
    }

    function test_AuthorizedAgencyCannotSubDelegate() public {
        // Holding ROLE_SELL_SLOT does not confer ROLE_SELL_SLOT_ADMIN.
        _grantSell(agency, HERO);
        vm.prank(agency);
        vm.expectRevert();
        registry.grantRoles(uint256(HERO), ROLE_SELL, stranger);
    }

    function test_CannotGrantOnUnregisteredSlot() public {
        vm.prank(publisher);
        vm.expectRevert();
        registry.grantRoles(uint256(UNKNOWN), ROLE_SELL, agency);
    }

    // ── ENSv2 quirks we must respect ────────────────────────────────────

    function test_TokenIdIsRegeneratedOnRoleChangeButLabelhashIsStable() public {
        uint256 before = registry.getTokenId(uint256(HERO));
        uint256 resourceBefore = registry.getResource(uint256(HERO));
        _grantSell(agency, HERO);
        uint256 afterGrant = registry.getTokenId(uint256(HERO));

        assertTrue(before != afterGrant, "ENSv2 regenerates the ERC-1155 token id on role change");
        assertEq(registry.getResource(uint256(HERO)), resourceBefore, "EAC resource is stable");
        // Which is exactly why ProofAds keys everything by labelhash:
        assertEq(registry.getOwner(uint256(HERO)), publisher);
        assertTrue(registry.isAuthorizedSeller(uint256(HERO), agency));
    }

    function test_ExpiredSlotHasNoOwnerAndNoSeller() public {
        _grantSell(agency, HERO);
        vm.warp(slotExpiry + 1);
        assertEq(registry.getOwner(uint256(HERO)), address(0));
        assertFalse(adapter.isAuthorizedSeller(HERO, agency));
    }

    // ── The adapter ─────────────────────────────────────────────────────

    function test_AdapterDerivesPublisherFromChain() public view {
        assertEq(adapter.getPublisher(HERO), publisher);
    }

    function test_AdapterRevertsForUnknownSlot() public {
        vm.expectRevert(abi.encodeWithSelector(ENSv2AuthorizationAdapter.SlotNotFound.selector, UNKNOWN));
        adapter.getPublisher(UNKNOWN);
    }

    function test_AdapterSlotIdIsRegistryScopedAndNotTokenId() public {
        bytes32 expected = keccak256(abi.encode(address(registry), HERO));
        assertEq(adapter.slotId(HERO), expected);
        _grantSell(agency, HERO);
        assertEq(adapter.slotId(HERO), expected, "slotId survives token regeneration");
    }

    function test_AdapterDescribeSlot() public {
        _grantSell(agency, HERO);
        (address p, bool authorized, uint64 expiry) = adapter.describeSlot(HERO, agency);
        assertEq(p, publisher);
        assertTrue(authorized);
        assertEq(expiry, slotExpiry);
    }
}
