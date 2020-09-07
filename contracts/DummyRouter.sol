// spdx-license-identifier: gpl-3.0-only
// solhint-disable func-name-mixedcase
pragma solidity ^0.6.12;

import "./Rad.sol";
import "./Router.sol";

contract DummyRouter is Router {
    Rad private rad;

    constructor(address _rad) public {
        rad = Rad(_rad);
    }

    function swapExactETHForTokens(
        uint256 amountOutMin,
        address[] calldata,
        address to,
        uint256
    ) external override payable returns (uint256[] memory) {
        rad.transfer(to, amountOutMin);

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = msg.value;
        amounts[1] = amountOutMin;

        return amounts;
    }

    function WETH() external override pure returns (address) {
        return address(0x123456789abcdef);
    }
}
