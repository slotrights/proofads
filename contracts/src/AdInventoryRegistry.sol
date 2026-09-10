// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {EACBaseRolesLib} from "@ensdomains/contracts-v2/access-control/libraries/EACBaseRolesLib.sol";
import {PermissionedRegistry} from "@ensdomains/contracts-v2/registry/PermissionedRegistry.sol";
import {ILabelStore} from "@ensdomains/contracts-v2/utils/interfaces/ILabelStore.sol";

/// @title AdInventoryRegistry
/// @notice An ENSv2 `PermissionedRegistry` whose names are advertising slots
///         (`hero.ads.<publisher>.eth`, `sidebar.ads.<publisher>.eth`).
///
/// @dev The only thing this contract adds to stock ENSv2 is one application-defined
///      Enhanced Access Control role, `ROLE_SELL_SLOT`, occupying nybble 10 of the EAC
///      bitmap. Nybbles 0-9 and 30-31 are taken by `RegistryRolesLib`; nybbles 10-29 are
///      unassigned, so nybble 10 (`1 << 40`) is a valid application role and its admin
///      counterpart is `1 << 168`.
///
///      Grant/revoke/query all go through the inherited, unmodified EAC machinery:
///      `grantRoles(anyId, ROLE_SELL_SLOT, agency)`, `revokeRoles(...)`,
///      `hasRoles(anyId, ROLE_SELL_SLOT, agency)`. The publisher passed to the constructor
///      receives `ALL_ROLES` on `ROOT_RESOURCE`, which includes `ROLE_SELL_SLOT_ADMIN`, so it
///      (and only it) may delegate selling rights per slot.
///
///      Note that ENSv2 regenerates the ERC-1155 token id on every role change
///      (`_onRolesGranted` -> `_regenerate`). Never key application state by token id;
///      key it by labelhash. `anyId` accepts a labelhash, token id or resource
///      interchangeably.
contract AdInventoryRegistry is PermissionedRegistry {
    /// @notice Nybble 10. Authorizes listing this slot for sale on the ProofAds marketplace.
    uint256 public constant ROLE_SELL_SLOT = 1 << 40;

    /// @notice Nybble 42. Authorizes granting and revoking `ROLE_SELL_SLOT`.
    uint256 public constant ROLE_SELL_SLOT_ADMIN = ROLE_SELL_SLOT << 128;

    /// @param labelStore The shared ENSv2 label database.
    /// @param publisher The account granted every root role, i.e. the owner of this inventory.
    constructor(ILabelStore labelStore, address publisher)
        PermissionedRegistry(labelStore, publisher, EACBaseRolesLib.ALL_ROLES)
    {}

    /// @notice Convenience view: may `account` sell the slot identified by `anyId`?
    /// @dev Pure sugar over the inherited `hasRoles`. The registry root holder (the publisher)
    ///      satisfies this through the EAC `ROOT_RESOURCE` fallback.
    /// @param anyId Labelhash, token id or resource of the slot.
    /// @param account The candidate seller.
    function isAuthorizedSeller(uint256 anyId, address account) external view returns (bool) {
        return hasRoles(anyId, ROLE_SELL_SLOT, account);
    }
}
