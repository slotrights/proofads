// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Minimal ENS name helpers used by deployment scripts.
library EnsNames {
    function labelhash(string memory label) internal pure returns (bytes32) {
        return keccak256(bytes(label));
    }

    /// @notice `namehash(label + "." + parent)`.
    function child(bytes32 parentNode, string memory label) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(parentNode, keccak256(bytes(label))));
    }
}
