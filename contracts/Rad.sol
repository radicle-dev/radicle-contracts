//SPDX-License-Identifier: ISC
pragma solidity ^0.6.2;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract Rad is ERC20 {
    uint256 public constant MAX_SUPPLY = 100000000e18;

    /// Construct a new Rad token.
    ///
    /// @param account The initial account to grant all the tokens
    /// @param initialSupply The initial amount of Rad tokens.
    constructor(address account, uint256 initialSupply)
        public
        ERC20("Rad", "RAD")
    {
        require(
            initialSupply <= MAX_SUPPLY,
            "The starting supply cannot be more than the max"
        );

        _mint(account, initialSupply.mul(10**uint256(decimals())));
    }
}
