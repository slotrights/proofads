// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice The subset of `AdInventoryRegistry` (ENSv2 `PermissionedRegistry` + one role)
///         that the marketplace needs. Kept minimal so the marketplace does not pull in
///         the whole ENSv2 dependency graph.
interface IAdInventoryRegistry {
    /// @notice ENSv2 Enhanced Access Control role check, resource-scoped with root fallback.
    function hasRoles(uint256 anyId, uint256 roleBitmap, address account) external view returns (bool);

    /// @notice ERC-1155 owner of the slot, or `address(0)` when unregistered or expired.
    function getOwner(uint256 anyId) external view returns (address);

    /// @notice Absolute unix timestamp at which the slot expires.
    function getExpiry(uint256 anyId) external view returns (uint64);

    /// @notice The application-defined selling role, `1 << 40`.
    function ROLE_SELL_SLOT() external view returns (uint256);
}
