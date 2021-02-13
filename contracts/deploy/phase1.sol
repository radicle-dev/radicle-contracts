// Rinkeby TUSDT: 0xd92e713d051c37ebb2561803a3b5fbabc4962431
// Rinkeby RAD: 0x66eF97b9EDE0c21EFc19c98a66245cd7C9791e28

pragma solidity ^0.7.5;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

struct PoolParams {
    // Balancer Pool Token (representing shares of the pool)
    string poolTokenSymbol;
    string poolTokenName;
    // Tokens inside the Pool
    address[] constituentTokens;
    uint256[] tokenBalances;
    uint256[] tokenWeights;
    uint256 swapFee;
}

struct Rights {
    bool canPauseSwapping;
    bool canChangeSwapFee;
    bool canChangeWeights;
    bool canAddRemoveTokens;
    bool canWhitelistLPs;
    bool canChangeCap;
}

library BalancerConstants {
    // B "ONE" - all math is in the "realm" of 10 ** 18;
    // where numeric 1 = 10 ** 18
    uint256 public constant BONE = 10**18;
    uint256 public constant MIN_WEIGHT = BONE;
    uint256 public constant MAX_WEIGHT = BONE * 50;
    uint256 public constant MAX_TOTAL_WEIGHT = BONE * 50;
    uint256 public constant MIN_BALANCE = BONE / 10**6;
    uint256 public constant MAX_BALANCE = BONE * 10**12;
    uint256 public constant MIN_POOL_SUPPLY = BONE * 100;
    uint256 public constant MAX_POOL_SUPPLY = BONE * 10**9;
    uint256 public constant MIN_FEE = BONE / 10**6;
    uint256 public constant MAX_FEE = BONE / 10;
}

interface IConfigurableRightsPool {
    function whitelistLiquidityProvider(address provider) external;
    function joinPool(uint256 poolAmountOut, uint256[] calldata maxAmountsIn) external;
}

interface ICRPFactory {
    function newCrp(
        address factoryAddress,
        PoolParams calldata poolParams,
        Rights calldata rights
    ) external returns (IConfigurableRightsPool);
}

interface IERC20Decimal is IERC20 {
    function decimals() external view returns (uint8);
}

contract Phase1 {
    IConfigurableRightsPool public immutable pool;
    IERC20Decimal public immutable radToken;
    IERC20Decimal public immutable usdcToken;

    // TODO: Call approve on both tokens!
    constructor(
        address bFactory,
        address crpFactory,
        IERC20Decimal _radToken,
        IERC20Decimal _usdcToken,
        address lp
    ) {
        ICRPFactory factory = ICRPFactory(crpFactory);

        uint256 radTokenBalance = 4 * (10 ** _radToken.decimals()); // 4 RAD
        uint256 radTokenWeight = (93 * BalancerConstants.BONE) / 2;

        uint256 usdcTokenBalance = 3 * (10 ** _usdcToken.decimals()); // 3 USDC
        uint256 usdcTokenWeight = (7 * BalancerConstants.BONE) / 2;

        Rights memory rights;
        rights.canPauseSwapping = false;
        rights.canChangeSwapFee = false;
        rights.canChangeWeights = true;
        rights.canAddRemoveTokens = false;
        rights.canWhitelistLPs = true;
        rights.canChangeCap = false;

        PoolParams memory params;
        params.poolTokenSymbol = "BRAD";
        params.poolTokenName = "Balancer RAD";

        params.constituentTokens = new address[](2);
        params.tokenBalances = new uint256[](2);
        params.tokenWeights = new uint256[](2);

        params.constituentTokens[0] = address(_radToken);
        params.tokenBalances[0] = radTokenBalance;
        params.tokenWeights[0] = radTokenWeight;

        params.constituentTokens[1] = address(_usdcToken);
        params.tokenBalances[1] = usdcTokenBalance;
        params.tokenWeights[1] = usdcTokenWeight;
        params.swapFee = BalancerConstants.MIN_FEE;

        IConfigurableRightsPool _pool = factory.newCrp(bFactory, params, rights);
        _pool.whitelistLiquidityProvider(lp);

        pool = _pool;
        radToken = _radToken;
        usdcToken = _usdcToken;
    }

    // TODO: Call approve on both tokens!
    function joinPool() public {
        uint256[] memory maxAmountsIn = new uint256[](2);
        maxAmountsIn[0] = 4000000 * (10 ** radToken.decimals()); // 4 million RAD
        maxAmountsIn[1] = 3000000 * (10 ** usdcToken.decimals()); // 3 million USDC

        pool.joinPool(0, maxAmountsIn);
    }
}
