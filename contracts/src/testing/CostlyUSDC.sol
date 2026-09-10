// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MockUSDC} from "./MockUSDC.sol";

/// @notice A settlement token that costs what a real one costs.
///
/// @dev `MockUSDC` is a bare OpenZeppelin ERC-20: a transfer is two warm storage writes and an
///      event. Circle's USDC is nothing like that — it is a `FiatTokenProxy` delegating into
///      `FiatTokenV2_2`, which checks pause state, checks the blacklist for both parties, and
///      carries the storage layout of a token that has been upgraded twice. A transfer through it
///      costs several times more.
///
///      That difference is not academic. Every contract test and the entire local end-to-end run
///      settle against `MockUSDC`, so the gas the Chainlink Forwarder must forward into
///      `onReport` was never exercised at a realistic price. The first settlement against real
///      USDC on Sepolia (tx `0xf50c3350...50e9f`) reverted `OutOfGas` inside `transfer`, and
///      because the Forwarder catches receiver reverts, the outer transaction still succeeded.
///      Nothing was paid and nothing looked wrong. See ADR-017.
///
///      This token exists so that the settlement gas budget is asserted rather than assumed. It
///      makes `COLD_WRITES` storage writes to previously-untouched slots on every transfer —
///      22,100 gas each — which puts a transfer comfortably above what Circle's USDC costs. A
///      settlement that fits inside the configured budget here fits on a public network.
contract CostlyUSDC is MockUSDC {
    /// @dev Zero-to-non-zero SSTOREs performed per transfer. Three ≈ 66,300 gas of overhead,
    ///      against roughly 45,000 for Circle's USDC over a bare ERC-20. Deliberately pessimistic.
    uint256 private constant COLD_WRITES = 3;

    uint256 private _cursor;
    mapping(uint256 slot => uint256 value) private _ballast;

    function _chargeRealTokenOverhead() private {
        uint256 cursor = _cursor;
        for (uint256 i = 0; i < COLD_WRITES; ++i) {
            _ballast[cursor + i] = 1; // fresh slot every time: always the cold price
        }
        _cursor = cursor + COLD_WRITES;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        _chargeRealTokenOverhead();
        return super.transfer(to, value);
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        _chargeRealTokenOverhead();
        return super.transferFrom(from, to, value);
    }
}
