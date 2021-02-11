// SPDX-License-Identifier: MIT
pragma solidity ^0.7.5;

/// Token vesting contract.
/// Adapted from Melonport AG <team@melonport.com>

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeMath96, SafeMath64} from "../libraries/SafeMath.sol";

contract VestingToken {
    using SafeMath96 for uint96;
    using SafeMath64 for uint64;

    ERC20 public immutable token; // Radicle ERC20 contract

    address public immutable owner; // deployer; can interrupt vesting
    uint96 public immutable totalVestingAmount; // quantity of vested token in total
    uint64 public immutable vestingStartTime; // timestamp when vesting is set
    uint64 public immutable vestingPeriod; // total vesting period in seconds
    uint64 public immutable cliffPeriod; // cliff period
    address public immutable beneficiary; // address of the beneficiary

    uint96 public withdrawn; // quantity of token withdrawn so far
    bool public interrupted; // whether vesting is still possible

    /// Vesting was terminated.
    event VestingTerminated(uint96 remainingVested, uint96 remainingUnvested);
    /// Vesting tokens were withdrawn
    event VestedWithdrawn(uint96 amount);

    modifier notInterrupted() {
        require(!interrupted, "The contract has been interrupted");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can do this");
        _;
    }

    modifier onlyBeneficiary() {
        require(msg.sender == beneficiary, "Only beneficiary can do this");
        _;
    }

    /// @notice Create a vesting allocation of tokens.
    ///
    /// @param _token Address of token being vested
    /// @param _beneficiary Address of beneficiary
    /// @param _amount Amount of tokens
    /// @param _vestingPeriod Vesting period in seconds from vestingStartTime
    /// @param _vestingStartTime Vesting start time in seconds since Epoch
    constructor(
        address _token,
        address _owner,
        address _beneficiary,
        uint96 _amount,
        uint64 _vestingStartTime,
        uint64 _vestingPeriod,
        uint64 _cliffPeriod
    ) {
        require(_beneficiary != address(0), "Beneficiary cannot be the zero address");
        require(_vestingStartTime < block.timestamp, "Vesting start time must be in the past");
        require(_vestingPeriod > 0, "Vesting period must be positive");
        require(_amount > 0, "VestingToken::constructor: amount must be positive");

        ERC20 erc20 = ERC20(_token);
        require(
            erc20.transferFrom(msg.sender, address(this), _amount),
            "VestingToken::constructor: token deposit failed"
        );

        token = erc20;
        owner = _owner;
        totalVestingAmount = _amount;
        beneficiary = _beneficiary;
        vestingStartTime = _vestingStartTime;
        vestingPeriod = _vestingPeriod;
        cliffPeriod = _cliffPeriod;
    }

    /// @notice Returns the token amount that is currently withdrawable
    /// @return withdrawable Quantity of withdrawable Radicle asset
    function withdrawableBalance() public view returns (uint96 withdrawable) {
        if (interrupted) return 0;

        uint64 timePassed = SafeMath64.from(block.timestamp).sub(vestingStartTime);

        if (timePassed < cliffPeriod) {
            withdrawable = 0;
        } else if (timePassed < vestingPeriod) {
            uint96 vested = totalVestingAmount.mul(timePassed) / vestingPeriod;
            withdrawable = vested.sub(withdrawn);
        } else {
            withdrawable = totalVestingAmount.sub(withdrawn);
        }
    }

    /// @notice Withdraw vested tokens
    function withdrawVested() external onlyBeneficiary notInterrupted {
        uint96 withdrawable = withdrawableBalance();

        withdrawn = withdrawn.add(withdrawable);

        require(
            token.transfer(beneficiary, withdrawable),
            "VestingToken::withdrawVested: transfer to beneficiary failed"
        );
        emit VestedWithdrawn(withdrawable);
    }

    /// @notice Force withdrawal of vested tokens to beneficiary
    /// @notice Send remainder back to owner
    /// @notice Prevent further vesting
    function terminateVesting() external onlyOwner notInterrupted {
        uint96 remainingVested = withdrawableBalance();
        uint96 totalToBeVested = withdrawn.add(remainingVested);
        uint96 remainingUnvested = totalVestingAmount.sub(totalToBeVested);

        interrupted = true;
        withdrawn = totalToBeVested;

        require(
            token.transfer(beneficiary, remainingVested),
            "VestingToken::terminateVesting: transfer to beneficiary failed"
        );
        require(
            token.transfer(owner, remainingUnvested),
            "VestingToken::terminateVesting: transfer to owner failed"
        );
        emit VestingTerminated(remainingVested, remainingUnvested);
    }
}
