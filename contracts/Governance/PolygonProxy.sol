// SPDX-License-Identifier: GPL-3.0-only

pragma solidity ^0.7.5;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface IRootChainManager {
    function exit(bytes calldata inputData) external;
}

interface IFxMessageProcessor {
    function processMessageFromRoot(
        uint256 stateId,
        address rootMessageSender,
        bytes calldata data
    ) external;
}

/// @notice An L2 proxy of an L1 owner, executes its commands received from an Fx tunnel
contract PolygonProxy is IFxMessageProcessor {
    /// @notice The owner of the proxy, the only L1 address from which commands are accepted
    address public immutable owner;
    address public immutable fxChild;

    /// @notice Emitted whenever a command is successfully executed
    event Executed(
        address target,
        uint256 value,
        string signature,
        bytes callData,
        bytes returnData,
        string description
    );

    constructor(address _owner, address _fxChild) {
        owner = _owner;
        fxChild = _fxChild;
    }

    /// @notice Process a message from L1
    /// @param rootMessageSender The L1 sender, must be the owner
    /// @param message The commands to execute.
    /// Must be ABI encoded like `Governor::propose` calldata minus the 4-byte selector.
    function processMessageFromRoot(
        uint256 stateId,
        address rootMessageSender,
        bytes calldata message
    ) external override {
        stateId;
        require(
            msg.sender == fxChild,
            "Proxy::processMessageFromRoot: only fxChild can call that function"
        );
        require(
            rootMessageSender == owner,
            "Proxy::processMessageFromRoot: message not from the owner"
        );
        (
            address[] memory targets,
            uint256[] memory values,
            string[] memory signatures,
            bytes[] memory callDatas,
            string memory description
        ) = abi.decode(message, (address[], uint256[], string[], bytes[], string));

        require(
            targets.length == values.length &&
                targets.length == signatures.length &&
                targets.length == callDatas.length,
            "Proxy::processMessageFromRoot: proposal function information arity mismatch"
        );
        require(targets.length != 0, "Proxy::processMessageFromRoot: must provide actions");
        require(targets.length <= 10, "Proxy::processMessageFromRoot: too many actions");
        for (uint256 i = 0; i < targets.length; i++) {
            address target = targets[i];
            uint256 value = values[i];
            string memory signature = signatures[i];
            bytes memory callData = callDatas[i];
            bytes memory callDataFull;
            if (bytes(signature).length == 0) {
                callDataFull = callData;
            } else {
                callDataFull = abi.encodePacked(bytes4(keccak256(bytes(signature))), callData);
            }
            // solhint-disable avoid-low-level-calls
            (bool success, bytes memory returnData) = target.call{value: value}(callDataFull);
            require(success, string(returnData));
            emit Executed(target, value, signature, callData, returnData, description);
        }
    }
}

/// @notice A contract for receiving L2->L1 transfers.
/// All funds it receives can be passed only to its owner.
/// It'll become obsolete when https://github.com/maticnetwork/pos-portal/pull/80 is implemented.
/// It must be deployed on L1 under the same address as the transfer sender on L2.
contract PolygonExiter {
    /// @notice The owner, who gets the received funds
    address payable public immutable owner;
    IRootChainManager public immutable rootChainManager;

    constructor(address payable _owner, IRootChainManager _rootChainManager) {
        owner = _owner;
        rootChainManager = _rootChainManager;
    }

    /// @notice Exits an L2->L1 transfer, see RootChainManager for more details
    function exit(bytes calldata inputData) public {
        rootChainManager.exit(inputData);
    }

    /// @notice Passes all received ETH to the owner
    function passEth() public {
        owner.transfer(address(this).balance);
    }

    /// @notice Passes all received ERC-20 tokens to the owner
    function passERC20(IERC20 erc20) public {
        uint256 balance = erc20.balanceOf(address(this));
        bool success = erc20.transfer(owner, balance);
        require(success, "PolygonExiter::passERC20: transfer failed");
    }

    /// @notice Passes a received ERC-721 token to the owner
    function passERC721(IERC721 erc721, uint256 tokenId) public {
        erc721.transferFrom(address(this), owner, tokenId);
    }
}

/// @notice Simplified test version of `Governor`, see `propose` for more details
contract DummyGovernor {
    /// @notice The only sender allowed to call `propose`
    address public immutable admin;

    /// @notice Emitted whenever a proposed transaction is executed
    event Executed(
        address target,
        uint256 value,
        string signature,
        bytes callData,
        bytes returnData,
        string description
    );

    constructor(address _admin) {
        admin = _admin;
    }

    /// @notice Same as `Governor::propose`. Instead of going through the voting
    /// process and passing transactions to `Timelock`, they are immediately executed
    function propose(
        address[] memory targets,
        uint256[] memory values,
        string[] memory signatures,
        bytes[] memory calldatas,
        string memory description
    ) public returns (uint256) {
        require(msg.sender == admin, "DummyGovernor::propose: the caller is not the admin");
        require(
            targets.length == values.length &&
                targets.length == signatures.length &&
                targets.length == calldatas.length,
            "DummyGovernor::propose: proposal function information arity mismatch"
        );
        require(targets.length != 0, "DummyGovernor::propose: must provide actions");
        require(targets.length <= 10, "DummyGovernor::propose: too many actions");
        for (uint256 i = 0; i < targets.length; i++) {
            address target = targets[i];
            uint256 value = values[i];
            string memory signature = signatures[i];
            bytes memory callData = calldatas[i];
            bytes memory callDataFull;
            if (bytes(signature).length == 0) {
                callDataFull = callData;
            } else {
                callDataFull = abi.encodePacked(bytes4(keccak256(bytes(signature))), callData);
            }
            // solhint-disable avoid-low-level-calls
            (bool success, bytes memory returnData) = target.call{value: value}(callDataFull);
            require(success, string(returnData));
            emit Executed(target, value, signature, callData, returnData, description);
        }
        return 0;
    }
}
