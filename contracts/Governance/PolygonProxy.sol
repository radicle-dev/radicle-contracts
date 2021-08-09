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

contract PolygonProxy is IFxMessageProcessor {
    address public immutable owner;
    address public immutable fxChild;

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

    function processMessageFromRoot(
        uint256 stateId,
        address rootMessageSender,
        bytes calldata encoded
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
        ) = abi.decode(encoded, (address[], uint256[], string[], bytes[], string));

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
                callDataFull = abi.encodeWithSignature(signature, callData);
            }
            // solhint-disable avoid-low-level-calls
            (bool success, bytes memory returnData) = target.call{value: value}(callDataFull);
            require(success, string(returnData));
            emit Executed(target, value, signature, callData, returnData, description);
        }
    }
}

// https://github.com/maticnetwork/pos-portal/pull/80
contract PolygonWithdrawer {
    address payable public immutable owner;
    IRootChainManager public immutable rootChainManager;

    constructor(address payable _owner, IRootChainManager _rootChainManager) {
        owner = _owner;
        rootChainManager = _rootChainManager;
    }

    function exit(bytes calldata inputData) public {
        rootChainManager.exit(inputData);
    }

    function passEth() public {
        owner.transfer(address(this).balance);
    }

    function passERC20(IERC20 erc20) public {
        uint256 balance = erc20.balanceOf(address(this));
        bool success = erc20.transfer(owner, balance);
        require(success, "Withdrawer::passERC20: transfer failed");
    }

    function passERC721(IERC721 erc721, uint256 tokenId) public {
        erc721.transferFrom(address(this), owner, tokenId);
    }
}

contract DummyGovernor {
    // The only sender allowed to call `propose`
    address public immutable admin;

    // Emitted whenever a proposed transaction is executed
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

    // The same ABI as `Governor::propose`, but instead of going through the voting process\
    // and passing transactions to `Timelock`, they are immediately executed
    function propose(
        address[] memory targets,
        uint256[] memory values,
        string[] memory signatures,
        bytes[] memory calldatas,
        string memory description
    ) public {
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
            bytes memory callData = callDatas[i];
            bytes memory callDataFull;
            if (bytes(signature).length == 0) {
                callDataFull = callData;
            } else {
                callDataFull = abi.encodeWithSignature(signature, callData);
            }
            // solhint-disable avoid-low-level-calls
            (bool success, bytes memory returnData) = target.call{value: value}(callDataFull);
            require(success, string(returnData));
            emit Executed(target, value, signature, callData, returnData, description);
        }
    }
}
