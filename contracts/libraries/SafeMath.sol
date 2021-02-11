pragma solidity ^0.7.5;

// a library for performing overflow-safe math, courtesy of DappHub (https://github.com/dapphub/ds-math)

library SafeMath {
    function add(uint256 x, uint256 y) internal pure returns (uint256) {
        return add(x, y, "ds-math-add-overflow");
    }

    function add(
        uint256 x,
        uint256 y,
        string memory message
    ) internal pure returns (uint256 result) {
        result = x + y;
        require(result >= x, message);
    }

    function sub(uint256 x, uint256 y) internal pure returns (uint256) {
        return sub(x, y, "ds-math-sub-underflow");
    }

    function sub(
        uint256 x,
        uint256 y,
        string memory message
    ) internal pure returns (uint256 result) {
        result = x - y;
        require(result <= x, message);
    }

    function mul(uint256 x, uint256 y) internal pure returns (uint256) {
        return mul(x, y, "ds-math-mul-overflow");
    }

    function mul(
        uint256 x,
        uint256 y,
        string memory message
    ) internal pure returns (uint256 result) {
        result = x * y;
        require(y == 0 || result / y == x, message);
    }
}

library SafeMath96 {
    function from(uint256 x) internal pure returns (uint96) {
        return from(x, "ds-math-from-overflow");
    }

    function from(uint256 x, string memory message) internal pure returns (uint96 result) {
        result = uint96(x);
        require(result == x, message);
    }

    function add(uint96 x, uint96 y) internal pure returns (uint96) {
        return add(x, y, "ds-math-add-overflow");
    }

    function add(
        uint96 x,
        uint96 y,
        string memory message
    ) internal pure returns (uint96 result) {
        result = x + y;
        require(result >= x, message);
    }

    function sub(uint96 x, uint96 y) internal pure returns (uint96) {
        return sub(x, y, "ds-math-sub-underflow");
    }

    function sub(
        uint96 x,
        uint96 y,
        string memory message
    ) internal pure returns (uint96 result) {
        result = x - y;
        require(result <= x, message);
    }

    function mul(uint96 x, uint96 y) internal pure returns (uint96) {
        return mul(x, y, "ds-math-mul-overflow");
    }

    function mul(
        uint96 x,
        uint96 y,
        string memory message
    ) internal pure returns (uint96 result) {
        result = x * y;
        require(y == 0 || result / y == x, message);
    }
}

library SafeMath64 {
    function from(uint256 x) internal pure returns (uint64) {
        return from(x, "ds-math-from-overflow");
    }

    function from(uint256 x, string memory message) internal pure returns (uint64 result) {
        result = uint64(x);
        require(result == x, message);
    }

    function add(uint64 x, uint64 y) internal pure returns (uint64) {
        return add(x, y, "ds-math-add-overflow");
    }

    function add(
        uint64 x,
        uint64 y,
        string memory message
    ) internal pure returns (uint64 result) {
        result = x + y;
        require(result >= x, message);
    }

    function sub(uint64 x, uint64 y) internal pure returns (uint64) {
        return sub(x, y, "ds-math-sub-underflow");
    }

    function sub(
        uint64 x,
        uint64 y,
        string memory message
    ) internal pure returns (uint64 result) {
        result = x - y;
        require(result <= x, message);
    }

    function mul(uint64 x, uint64 y) internal pure returns (uint64) {
        return mul(x, y, "ds-math-mul-overflow");
    }

    function mul(
        uint64 x,
        uint64 y,
        string memory message
    ) internal pure returns (uint64 result) {
        result = x * y;
        require(y == 0 || result / y == x, message);
    }
}
