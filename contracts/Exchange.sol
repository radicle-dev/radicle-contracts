// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.12;

import "./Rad.sol";
import "./PriceOracle.sol";
import "./Router.sol";

contract Exchange {
    Router private router;
    PriceOracle private oracle;
    Rad private rad;

    constructor(
        address _rad,
        address _exchange,
        address _oracle
    ) public {
        rad = Rad(_rad);
        oracle = PriceOracle(_oracle);
        router = Router(_exchange);
    }

    function swapEthForRad(address receiver) public payable returns (uint256) {
        require(msg.value > 0, "Swap amount should be positive");

        address[] memory path = new address[](2);
        path[0] = router.WETH();
        path[1] = address(rad);

        // The minimum amount of Rad we're willing to receive in exchange.
        uint256 minimumRad = oracle.consultEthRad(msg.value);

        uint256[] memory amounts = router.swapExactETHForTokens(
            minimumRad,
            path,
            receiver,
            block.timestamp
        );

        uint256 radAmount = amounts[1];
        require(radAmount >= minimumRad, "Enough Rad was exchanged");

        return radAmount;
    }
}
