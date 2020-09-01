// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.12;

import "@ensdomains/ens/contracts/ENS.sol";

contract Registrar {
    /// The ENS registry.
    ENS public ens;

    /// The namehash of the domain this registrar owns(eg. radicle.eth).
    bytes32 public rootNode;

    /// Registration fee in *USD*.
    uint256 constant public REGISTRATION_FEE = 10;

    constructor(address ensAddress, bytes32 _rootNode) public {
        ens = ENS(ensAddress);
        rootNode = _rootNode;
    }

    /// Register a subdomain.
    function register(bytes32 label, address owner) payable public {
        uint256 fee = registrationFee();

        require(msg.value >= fee);

        bytes32 node = namehash(label);
        address currentOwner = ens.owner(node);

        require(currentOwner == address(0) || currentOwner == msg.sender);

        // Return change.
        if (msg.value > fee {
            msg.sender.transfer(msg.value - fee);
        }

        ens.setSubnodeOwner(rootNode, label, owner);
    }

    function valid(string memory name) public pure returns(bool) {
        // FIXME(cloudhead): This is only correct for ASCII.
        return bytes(name).length >= 3;
    }

    function available(string memory name) public view returns(bool) {
        bytes32 label = keccak256(bytes(name));
        bytes32 node = namehash(label);

        return valid(name) && !ens.recordExists(node);
    }

    function namehash(bytes32 label) view public returns(bytes32) {
        return keccak256(abi.encodePacked(rootNode, label));
    }

    /// Registration fee in `wei`.
    function registrationFee() public pure returns(uint256) {
        // TODO(cloudhead): Use a price oracle to convert the USD
        // fee into wei.
        return 10 wei;
    }
}
