// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.12;

import "@ensdomains/ens/contracts/ENS.sol";

contract Registrar {
    /// The ENS registry.
    ENS public ens;

    /// The namehash of the domain this registrar owns(eg. radicle.eth).
    bytes32 public rootNode;

    constructor(address ensAddress, bytes32 _rootNode) public {
        ens = ENS(ensAddress);
        rootNode = _rootNode;
    }

    /// Register a subdomain.
    function register(bytes32 subNode, address owner) public {
        bytes32 node = keccak256(abi.encodePacked(rootNode, subNode));
        address currentOwner = ens.owner(node);

        require(currentOwner == address(0) || currentOwner == msg.sender);

        ens.setSubnodeOwner(rootNode, subNode, owner);
    }
}
