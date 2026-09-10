// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IAdInventoryRegistry} from "./interfaces/IAdInventoryRegistry.sol";

/// @title ENSv2AuthorizationAdapter
/// @notice The single place where ProofAds asks ENS "who owns this ad slot, and who may sell it?".
/// @dev Stateless by construction: it stores no authorization of its own, it only forwards to
///      the ENSv2 registry at call time. That is what makes a revocation take effect immediately
///      everywhere in the protocol.
contract ENSv2AuthorizationAdapter {
    /// @notice The ENSv2 registry holding the ad-slot hierarchy.
    IAdInventoryRegistry public immutable REGISTRY;

    /// @notice Cached copy of `REGISTRY.ROLE_SELL_SLOT()` (a compile-time constant on the registry).
    uint256 public immutable ROLE_SELL_SLOT;

    error SlotNotFound(bytes32 labelhash);
    error ZeroAddress();

    constructor(IAdInventoryRegistry registry) {
        if (address(registry) == address(0)) revert ZeroAddress();
        REGISTRY = registry;
        ROLE_SELL_SLOT = registry.ROLE_SELL_SLOT();
    }

    /// @notice Protocol-wide identity of a slot: the registry address plus the ENS labelhash.
    /// @dev Deliberately NOT the ERC-1155 token id, which ENSv2 regenerates on every role change.
    function slotId(bytes32 labelhash) public view returns (bytes32) {
        return keccak256(abi.encode(address(REGISTRY), labelhash));
    }

    /// @notice The publisher: the current ENS owner of the slot. Reverts if the slot does not exist.
    /// @dev Never supplied by a caller. This is how payout addresses are derived.
    function getPublisher(bytes32 labelhash) public view returns (address publisher) {
        publisher = REGISTRY.getOwner(uint256(labelhash));
        if (publisher == address(0)) revert SlotNotFound(labelhash);
    }

    /// @notice May `seller` list this slot right now?
    /// @dev True for the slot owner, and for any account holding `ROLE_SELL_SLOT` on the slot's
    ///      EAC resource. Returns false (rather than reverting) for unknown or expired slots so
    ///      callers can branch instead of catching.
    function isAuthorizedSeller(bytes32 labelhash, address seller) public view returns (bool) {
        address publisher = REGISTRY.getOwner(uint256(labelhash));
        if (publisher == address(0)) return false;
        if (seller == publisher) return true;
        return REGISTRY.hasRoles(uint256(labelhash), ROLE_SELL_SLOT, seller);
    }

    /// @notice Slot expiry as recorded by ENSv2.
    function slotExpiry(bytes32 labelhash) external view returns (uint64) {
        return REGISTRY.getExpiry(uint256(labelhash));
    }

    /// @notice Convenience for UIs: publisher (zero when absent) plus authorization in one call.
    function describeSlot(bytes32 labelhash, address seller)
        external
        view
        returns (address publisher, bool authorized, uint64 expiry)
    {
        publisher = REGISTRY.getOwner(uint256(labelhash));
        authorized = isAuthorizedSeller(labelhash, seller);
        expiry = REGISTRY.getExpiry(uint256(labelhash));
    }
}
