// Rinkeby TUSDT: 0xd92e713d051c37ebb2561803a3b5fbabc4962431
// Rinkeby RAD: 0x66eF97b9EDE0c21EFc19c98a66245cd7C9791e28
// Rinkeyby Core Pool Factory: 0x9C84391B443ea3a48788079a5f98e2EaD55c9309
// Rinkeby CRP Factory: 0xA3F9145CB0B50D907930840BB2dcfF4146df8Ab4

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

    function setController(address newOwner) external;

    function createPool(
        uint256 initialSupply,
        uint256 minimumWeightChangeBlockPeriodParam,
        uint256 addTokenTimeLockInBlocksParam
    ) external;

    function updateWeightsGradually(
        uint256[] calldata newWeights,
        uint256 startBlock,
        uint256 endBlock
    ) external;

    function bPool() external view returns (address);
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
    IConfigurableRightsPool public immutable crpPool;
    IERC20Decimal public immutable radToken;
    IERC20Decimal public immutable usdcToken;
    Sale public immutable sale;

    uint256 public constant RAD_BALANCE = 4000000; // 4 million RAD
    uint256 public constant USDC_BALANCE = 3000000; // 3 million USDC
    uint256 public constant RAD_WEIGHT = 38;
    uint256 public constant USDC_WEIGHT = 2;

    // TODO: Call approve on both tokens!
    constructor(
        address bFactory,
        address crpFactory,
        IERC20Decimal _radToken,
        IERC20Decimal _usdcToken,
        address lp
    ) {
        ICRPFactory factory = ICRPFactory(crpFactory);

        uint256 radTokenBalance = RAD_BALANCE * (10**_radToken.decimals());
        uint256 radTokenWeight = RAD_WEIGHT * BalancerConstants.BONE;

        uint256 usdcTokenBalance = USDC_BALANCE * (10**_usdcToken.decimals());
        uint256 usdcTokenWeight = USDC_WEIGHT * BalancerConstants.BONE;

        Rights memory rights;
        rights.canPauseSwapping = false;
        rights.canChangeSwapFee = false;
        rights.canChangeWeights = true;
        rights.canAddRemoveTokens = false;
        rights.canWhitelistLPs = true;
        rights.canChangeCap = false;

        PoolParams memory params;
        params.poolTokenSymbol = "RADP";
        params.poolTokenName = "RAD Pool Token";

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

        IConfigurableRightsPool _crpPool = factory.newCrp(bFactory, params, rights);
        _crpPool.whitelistLiquidityProvider(lp);

        // Create the sale contract and transfer ownership of the CRP to the sale contract.
        sale = new Sale(_crpPool, radTokenBalance, usdcTokenBalance);
        _crpPool.setController(address(sale));

        crpPool = _crpPool;
        radToken = _radToken;
        usdcToken = _usdcToken;
    }

    function bPool() public view returns (address) {
        return crpPool.bPool();
    }
}

contract Sale {
    IConfigurableRightsPool public immutable crpPool;

    uint256 immutable radTokenBalance;
    uint256 immutable usdcTokenBalance;
    uint256 immutable blocksPerHour;

    uint256 public constant RAD_END_WEIGHT = 20;
    uint256 public constant USDC_END_WEIGHT = 20;

    constructor(
        IConfigurableRightsPool _crpPool,
        uint256 _radTokenBalance,
        uint256 _usdcTokenBalance,
        uint256 _blocksPerHour
    ) {
        crpPool = _crpPool;
        radTokenBalance = _radTokenBalance;
        usdcTokenBalance = _usdcTokenBalance;
        blocksPerHour = _blocksPerHour;
    }

    function begin(uint256 minimumWeightChangeBlockPeriod, uint256 addTokenTimeLockInBlocks)
        public
    {
        radToken.approve(address(this), radTokenBalance);
        usdcToken.approve(address(this), usdcTokenBalance);
        radToken.transfer(address(this), radTokenBalance);
        usdcToken.transfer(address(this), usdcTokenBalance);

        radToken.approve(address(crpPool), radTokenBalance);
        usdcToken.approve(address(crpPool), usdcTokenBalance);

        uint256 poolTokens = 100 * BalancerConstants.BONE;

        crpPool.createPool(poolTokens, minimumWeightChangeBlockPeriod, addTokenTimeLockInBlocks);

        require(
            crpPool.totalSupply() == poolTokens,
            "Sale::begin: pool tokens must match total supply"
        );

        uint256[] memory endWeights = new uint256[](2);
        endWeights[0] = RAD_END_WEIGHT * BalancerConstants.BONE;
        endWeights[1] = USDC_END_WEIGHT * BalancerConstants.BONE;

        uint256 startBlock = block.number + blocksPerHour;
        uint256 endBlock = startBlock + minimumWeightChangeBlockPeriod;

        crpPool.updateWeightsGradually(endWeights, startBlock, endBlock);
        crpPool.transfer(msg.sender, poolTokens);
    }
}
