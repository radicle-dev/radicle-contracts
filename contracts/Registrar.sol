// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.12;

import "@ensdomains/ens/contracts/ENS.sol";

contract Registrar {
    /// The ENS registry.
    ENS public ens;

    /// The namehash of the domain this registrar owns(eg. radicle.eth).
    bytes32 public rootNode;

    /// Registration fee in *USD*.
    uint256 public constant REGISTRATION_FEE = 10;

    constructor(address ensAddress, bytes32 _rootNode) public {
        ens = ENS(ensAddress);
        rootNode = _rootNode;
    }

    /// Register a subdomain.
    function register(string memory name, address owner) public payable {
        uint256 fee = registrationFee();

        require(msg.value >= fee);
        require(valid(name));

        _register(keccak256(bytes(name)), owner);

        // Return change.
        if (msg.value > fee) {
            msg.sender.transfer(msg.value - fee);
        }
    }

    function _register(bytes32 label, address owner) private {
        bytes32 node = namehash(rootNode, label);

        require(!ens.recordExists(node));

        ens.setSubnodeOwner(rootNode, label, owner);
    }

    /// Check whether a name is valid.
    function valid(string memory name) public pure returns (bool) {
        // FIXME(cloudhead): This is only correct for ASCII.
        return bytes(name).length >= 3;
    }

    /// Check whether a name is available for registration.
    function available(string memory name) public view returns (bool) {
        bytes32 label = keccak256(bytes(name));
        bytes32 node = namehash(rootNode, label);

        return valid(name) && !ens.recordExists(node);
    }

    /// Get the "namehash" of a label.
    function namehash(bytes32 parent, bytes32 label)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(parent, label));
    }

    /// Registration fee in `wei`.
    function registrationFee() public pure returns (uint256) {
        // TODO(cloudhead): Use a price oracle to convert the USD
        // fee into wei.
        return 10 wei;
    }
}
