// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.12;

import "./PriceOracle.sol";
import "./FixedWindowOracle.sol";

contract StablePriceOracle is PriceOracle {
    /// Uniswap USD/ETH price oracle.
    FixedWindowOracle public usdEthOracle;
    /// Uniswap ETH/RAD price oracle.
    FixedWindowOracle public ethRadOracle;

    constructor(address _usdEthOracle, address _ethRadOracle) public {
        usdEthOracle = FixedWindowOracle(_usdEthOracle);
        ethRadOracle = FixedWindowOracle(_ethRadOracle);
    }

    function updatePrices() public override {
        usdEthOracle.update();
        ethRadOracle.update();
    }

    function consultUsdEth(uint256 usdAmount)
        public
        override
        view
        returns (uint256)
    {
        return usdEthOracle.consult(usdAmount);
    }

    function consultEthRad(uint256 ethAmount)
        public
        override
        view
        returns (uint256)
    {
        return ethRadOracle.consult(ethAmount);
    }
}
