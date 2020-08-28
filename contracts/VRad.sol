// SPDX-License-Identifier: ISC
pragma solidity ^0.6.2;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "./Rad.sol";

/// A token allocation of vRad.
struct Allocation {
    /// Vesting start time in seconds since Epoch.
    uint256 vestingStart;
    /// Vesting cliff duration.
    uint256 vestingCliffDuration;
    /// Vesting total (including cliff) duration in seconds.
    uint256 vestingDuration;
}

/// The vRad token.
///
/// This contract implements a simple vesting token (vRad) that can be redeemed
/// for an equal amount of Rad when the vesting period is over.
///
/// The general idea is the following:
///
/// 1. The contract is initialized with a "grantor" who has the right
///    to grant vRad to an address. The contract starts out with a zero
///    balance.
/// 2. The contract supply is expanded via `expandTokenSupply`. With this
///    method, the sender can transfer Rad to mint an equal amount of vRad
///    into the contract's supply. The contract now holds an equal amount of
///    Rad and vRad.
/// 3. When the grantor wants to grant tokens to an address, they call
///    `allocateTokens`. This simply transfers vRad from the contract
///    to the "grantee", and records the vesting rules for that allocation.
/// 4. The grantee can then call `getVestedAmount` at all times to check their
///    amount of vested tokens.
/// 5. When this amount is non-zero, the grantee can redeem vRad for Rad, by
///    calling `redeemTokens` with an amount. As long as this amount isn't
///    greater than the vested amount, the contract supply is shrunk via
///    `shrinkTokenSupply`: the specified amount of vRad is burned, and an
///    equal amount of Rad is transfered from the contract to the redeemer.
///
contract VRad is ERC20 {
    /// The Rad token.
    Rad private immutable rad;

    /// Token allocations.
    mapping(address => Allocation) public allocations;

    /// The grantor of token allocations.
    address public grantor;

    /// Construct a new VRad token.
    ///
    /// @param _rad The address of the Rad ERC20 contract.
    /// @param _grantor The initial account to grant all the tokens to.
    constructor(address _rad, address _grantor) public ERC20("vRad", "vRAD") {
        rad = Rad(_rad);
        grantor = _grantor;
    }

    /// Expand the supply of Rad and vRad held by this contract equally.
    function expandTokenSupply(uint256 amount) public {
        // TODO: Approve sender?

        // Transfer the Rad.
        require(
            rad.transferFrom(msg.sender, address(this), amount),
            "The transfer in should succeed"
        );
        // Mint an equal amount of vRad.
        _mint(address(this), amount);
    }

    /// Shrink the supply of Rad and vRad held by this contract equally.
    function shrinkTokenSupply(address payable receiver, uint256 amount)
        internal
    {
        // Transfer out an equal amount of Rad from the contract to the receiver.
        require(
            rad.transferFrom(address(this), receiver, amount),
            "The transfer out should succeed"
        );
        // Burn an amount of vRad from the sender.
        _burn(msg.sender, amount);
    }

    /// Allocate vesting tokens to an address.
    function allocateTokens(
        address grantee,
        uint256 amount,
        uint32 vestingStart,
        uint32 vestingCliffDuration,
        uint32 vestingDuration
    ) public {
        require(
            balanceOf(grantee) == 0,
            "Grantee must not already have an allocation"
        );
        require(
            vestingDuration >= vestingCliffDuration,
            "Cliff must not be longer than total duration"
        );

        // Nb. It's okay for the vesting/cliff duration to be zero.

        _allocate(grantee, amount);

        allocations[grantee].vestingStart = vestingStart;
        allocations[grantee].vestingCliffDuration = vestingCliffDuration;
        allocations[grantee].vestingDuration = vestingDuration;
    }

    /// Increase the vesting token allocation of an address.
    function increaseAllocation(address grantee, uint256 amount) public {
        require(
            balanceOf(grantee) > 0,
            "Grantee must already have an allocation"
        );

        _allocate(grantee, amount);
    }

    /// Get the amount of currently vested tokens for an address.
    function getVestedAmount(address grantee) public view returns (uint256) {
        uint256 vestingAmount = balanceOf(grantee);

        require(vestingAmount > 0, "Grantee must already have an allocation");

        Allocation memory alloc = allocations[grantee];
        uint256 elapsed = now - alloc.vestingStart;

        if (elapsed < alloc.vestingCliffDuration) {
            return 0;
        }

        if (alloc.vestingDuration == 0) {
            return vestingAmount;
        }

        uint256 vestedAmount = (elapsed / alloc.vestingDuration) *
            vestingAmount;

        if (vestedAmount > vestingAmount) {
            vestedAmount = vestingAmount;
        }

        return vestedAmount;
    }

    /// Redeem vRad tokens for Rad tokens.
    function redeemTokens(address payable receiver, uint256 amount) public {
        require(amount > 0, "Redeem amount must be positive");
        require(
            getVestedAmount(msg.sender) >= amount,
            "Redeem amount should be vested"
        );

        shrinkTokenSupply(receiver, amount);
    }

    /// Transfer the given amount of tokens from the contract to the grantee.
    function _allocate(address grantee, uint256 amount) internal {
        require(msg.sender == grantor, "Only the grantor can allocate tokens");
        require(grantee != address(0), "Grantee cannot be the zero address");
        require(
            amount <= balanceOf(address(this)),
            "Cannot allocate more than the allowance"
        );

        // Make the actual transfer.
        require(
            transferFrom(address(this), grantee, amount),
            "Transfer from contract must be valid"
        );
    }
}
