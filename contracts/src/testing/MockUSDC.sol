// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice 6-decimal ERC-20 standing in for Circle USDC on local chains and in tests.
///         On Sepolia the real Circle USDC at 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 is used.
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin (ProofAds local)", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
