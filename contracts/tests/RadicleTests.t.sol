pragma solidity ^0.7.5;
pragma abicoder v2;


import {RadicleToken}  from "../Governance/RadicleToken.sol";
import {Governor}      from "../Governance/Governor.sol";
import {Timelock}      from "../Governance/Timelock.sol";
import {Treasury}      from "../Governance/Treasury.sol";
import {VestingToken}  from "../Governance/VestingToken.sol";
import {Registrar}     from "../Registrar.sol";
import {ENS}           from "@ensdomains/ens/contracts/ENS.sol";
import {ENSRegistry}   from "@ensdomains/ens/contracts/ENSRegistry.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol";
import {IERC721}       from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import {DSTest} from "ds-test/test.sol";
import {DSMath} from "ds-math/math.sol";

interface Hevm {
    function warp(uint256) external;
    function roll(uint256) external;
    function store(address,bytes32,bytes32) external;
}

contract VestingUser {
    function withdrawVested(VestingToken vest) public {
        vest.withdrawVested();
    }
}

contract VestingOwner {
    function terminateVesting(VestingToken vest) public {
        vest.terminateVesting();
    }
}

contract VestingTokenTests is DSTest, DSMath {
    RadicleToken rad;
    VestingUser user;
    VestingOwner owner;
    Hevm hevm = Hevm(HEVM_ADDRESS);

    function setUp() public {
        hevm.warp(12345678);

        rad = new RadicleToken(address(this));
        user = new VestingUser();
        owner = new VestingOwner();
    }

    // Demonstrates a bug where withdrawableBalance() always reverts after
    // vesting has been interrupted.
    function testFail_vesting_failure() public {
        VestingToken vest = Utils.mkVestingToken(
            address(rad),
            address(this),
            address(user),
            10000000 ether,
            block.timestamp - 1,
            2 weeks,
            1 days
        );

        hevm.warp(block.timestamp + 2 days);
        vest.terminateVesting();
        hevm.warp(block.timestamp + 1 days);

        // withdrawableBalance reverts if vesting was interrupted
        vest.withdrawableBalance();
    }

    // `withdrawableBalance()` should always return the actual amount that will
    // be withdrawan when calling `withdrawVested()`
    function test_withdrawal_amount(
        uint24 jump, uint24 amount, uint8 startOffset, uint24 vestingPeriod, uint24 cliffPeriod
    ) public {
        if (vestingPeriod == 0) return;
        if (startOffset == 0) return;
        if (amount == 0) return;
        if (amount > 10000000 ether) return;

        VestingToken vest = Utils.mkVestingToken(
            address(rad),
            address(this),
            address(user),
            amount,
            block.timestamp - startOffset,
            vestingPeriod,
            cliffPeriod
        );

        hevm.warp(block.timestamp + jump);

        uint amt = vest.withdrawableBalance();
        uint prebal = rad.balanceOf(address(user));

        user.withdrawVested(vest);
        uint postbal = rad.balanceOf(address(user));

        assertEq(postbal - prebal, amt, "withdrawn amount matches withdrawableBalance");
    }

    // The VestingToken should be empty after `terminateVesting()` has been called
    // The beneficiary should have received all vested tokens
    // The owner should have received all unvested tokens
    function test_empty_after_termination(
        uint24 jump, uint24 amount, uint8 startOffset, uint24 vestingPeriod, uint24 cliffPeriod
    ) public {
        if (vestingPeriod == 0) return;
        if (startOffset == 0) return;
        if (amount == 0) return;
        if (amount > 10000000 ether) return;

        VestingToken vest = Utils.mkVestingToken(
            address(rad),
            address(owner),
            address(user),
            amount,
            block.timestamp - startOffset,
            vestingPeriod,
            cliffPeriod
        );

        hevm.warp(block.timestamp + jump);

        assertEq(rad.balanceOf(address(vest)), amount);
        uint vested = vest.withdrawableBalance();
        log_named_uint("vested", vested);
        log_named_uint("amount", amount);
        uint unvested = sub(amount, vest.withdrawableBalance());

        owner.terminateVesting(vest);

        assertEq(
            rad.balanceOf(address(vest)), 0,
            "vesting token is empty"
        );
        assertEq(
            rad.balanceOf(address(user)), vested,
            "beneficiary has received all vested tokens"
        );
        assertEq(
            rad.balanceOf(address(owner)), unvested,
            "owner has received all unvested tokens"
        );
    }

    // The `withdrawn` attribute should always accurately reflect the actual amount withdrawn
    // Demonstrates a bug where the withdrawn attribute is set to a misleading value after termination
    function test_withdrawn_accounting(
        uint8 jump, uint24 amount, uint8 startOffset, uint24 vestingPeriod, uint24 cliffPeriod
    ) public {
        if (vestingPeriod == 0) return;
        if (startOffset == 0) return;
        if (amount == 0) return;
        if (amount > 10000000 ether) return;

        VestingToken vest = Utils.mkVestingToken(
            address(rad),
            address(owner),
            address(user),
            amount,
            block.timestamp - startOffset,
            vestingPeriod,
            cliffPeriod
        );

        uint withdrawn = 0;

        for (uint i; i < 10; i++) {
            hevm.warp(block.timestamp + jump);
            uint prebal = rad.balanceOf(address(user));
            user.withdrawVested(vest);

            uint postbal = rad.balanceOf(address(user));
            withdrawn = add(withdrawn, postbal - prebal);
        }

        assertEq(withdrawn, vest.withdrawn(), "pre-termination");

        hevm.warp(block.timestamp + jump);
        uint withdrawable = vest.withdrawableBalance();
        owner.terminateVesting(vest);

        assertEq(vest.withdrawn(), add(withdrawn, withdrawable), "post-termination");
    }
}

contract TreasuryTests is DSTest {
    Hevm hevm = Hevm(HEVM_ADDRESS);
    Treasury treasury;

    function setUp() public {
        treasury = new Treasury(address(this));
    }

    function test_initial() public {
        assertEq(treasury.admin(), address(this));
        address(treasury).transfer(100 ether);
        assertEq(address(treasury).balance, 100 ether);
        treasury.withdraw(address(2), 10 ether);
        assertEq(address(treasury).balance, 90 ether);
    }
}

contract RegistrarRPCTests is DSTest {
    ENS ens;
    RadicleToken rad;
    Registrar registrar;
    bytes32 domain;
    uint tokenId;
    Hevm hevm = Hevm(HEVM_ADDRESS);

    function setUp() public {
        domain = Utils.namehash(["radicle", "eth"]);
        tokenId = uint(keccak256(abi.encodePacked("radicle"))); // seth keccak radicle
        ens = ENS(0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e);
        rad = new RadicleToken(address(this));
        registrar = new Registrar(
            ens,
            domain,
            tokenId,
            address(0), // irrelevant in this version
            address(0), // irrelevant in this version
            ERC20Burnable(address(rad)),
            address(this)
        );

        // make the registrar the owner of the radicle.eth domain
        hevm.store(
            address(ens),
            keccak256(abi.encodePacked(domain, uint(0))),
            Utils.asBytes32(address(registrar))
        );

        // make the registrar the owner of the radicle.eth 721 token
        address ethRegistrarAddr = ens.owner(Utils.namehash(["eth"]));

        // owner[tokenId]
        // TODO: make this less inscrutible
        hevm.store(
            ethRegistrarAddr,
            0x7906724a382e1baec969d07da2f219928e717131ddfd68dbe3d678f62fa3065b,
            Utils.asBytes32(address(registrar))
        );

        // ownedTokensCount[address(registrar)]
        // TODO: make this less inscrutible
        hevm.store(
            ethRegistrarAddr,
            0x27a5c9c1f678324d928c72a6ff8a66d3c79aa98b4c10804760d4542336658cc7,
            bytes32(uint(1))
        );
    }

    // --- tests ---

    // the ownership of the correct node in ens changes after domain registration
    function test_register(string memory name) public {
        if (bytes(name).length == 0) return;
        if (bytes(name).length > 32) return;
        bytes32 node = Utils.namehash([name, "radicle", "eth"]);

        assertEq(ens.owner(node), address(0));
        registerWith(registrar, name);
        assertEq(ens.owner(node), address(this));
    }

    // BUG: the resolver is address(0x0) for radicle subdomains
    function test_resolverUnset() public {
        bytes32 node = Utils.namehash(["microsoft", "radicle", "eth"]);

        assertEq(ens.owner(node), address(0));
        registerWith(registrar, "microsoft");
        assertEq(ens.owner(node), address(this));
        assertEq(ens.resolver(node), ens.resolver(Utils.namehash(["radicle", "eth"])));
    }


    // BUG: names transfered to the zero address can never be reregistered
    function test_reregistration(string memory name) public {
        if (bytes(name).length == 0) return;
        if (bytes(name).length > 32) return;
        bytes32 node = Utils.namehash([name, "radicle", "eth"]);
        registerWith(registrar, name);

        ens.setOwner(node, address(0));
        assertEq(ens.owner(node), address(0));
        assertTrue(ens.recordExists(node));

        registerWith(registrar, name);
        assertEq(ens.owner(node), address(this));
    }

    // domain registration still works after transfering ownership of the
    // "radicle.eth" domain to a new registrar
    function test_register_with_new_owner(string memory name) public {
        if (bytes(name).length == 0) return;
        if (bytes(name).length > 32) return;

        Registrar registrar2 = new Registrar(
            ens,
            domain,
            tokenId,
            address(0), // irrelevant in this version
            address(0), // irrelevant in this version
            ERC20Burnable(address(rad)),
            address(this)
        );
        registrar.setDomainOwner(address(registrar2));
        registerWith(registrar2, name);

        assertEq(ens.owner(Utils.namehash([name, "radicle", "eth"])), address(this));
    }

    // a domain that has already been registered cannot be registered again
    function testFail_double_register(string memory name) public {
        require(bytes(name).length > 0);
        require(bytes(name).length <= 32);

        registerWith(registrar, name);
        registerWith(registrar, name);
    }

    // Utils.nameshash does the right thing for radicle.eth subdomains
    function test_namehash(string memory name) public {
        bytes32 node = Utils.namehash([name, "radicle", "eth"]);
        assertEq(node, keccak256(abi.encodePacked(
            keccak256(abi.encodePacked(
                keccak256(abi.encodePacked(
                    bytes32(uint(0)),
                    keccak256("eth")
                )),
                keccak256("radicle")
            )),
            keccak256(bytes(name))
        )));
    }

    // --- helpers ---

    function registerWith(Registrar reg, string memory name) internal {
        uint preBal = rad.balanceOf(address(this));

        rad.approve(address(reg), uint(-1));
        reg.registerRad(name, address(this));

        assertEq(rad.balanceOf(address(this)), preBal - 1 ether);
    }
}

contract RadUser {
    RadicleToken rad;
    Governor   gov;
    constructor (RadicleToken rad_, Governor gov_) public {
        rad = rad_;
        gov = gov_;
    }
    function delegate(address to) public {
        rad.delegate(to);
    }
    function transfer(address to, uint amt) public {
        rad.transfer(to, amt);
    }
    function burn(uint amt) public {
        rad.burnFrom(address(this), amt);
    }

    function propose(address target, string memory sig, bytes memory cd) public {
        address[] memory targets = new address[](1);
        uint[] memory values = new uint[](1);
        string[] memory sigs = new string[](1);
        bytes[] memory calldatas = new bytes[](1);
        targets[0] = target;
        values[0] = 0;
        sigs[0] = sig;
        calldatas[0] = cd;
        gov.propose(targets, values, sigs, calldatas, "");
    }
}

contract GovernanceTest is DSTest {
    Governor gov;
    RadicleToken rad;
    RadUser usr;
    RadUser ali;
    RadUser bob;
    Timelock timelock;

    uint x; // only writeable by timelock

    Hevm hevm = Hevm(HEVM_ADDRESS);

    function setUp() public {
        rad = new RadicleToken(address(this));
        timelock = new Timelock(address(this), 2 days);
        gov = new Governor(address(timelock), address(rad), address(this));
        usr = new RadUser(rad, gov);
        ali = new RadUser(rad, gov);
        bob = new RadUser(rad, gov);
        rad.transfer(address(ali), 500_000 ether);
        rad.transfer(address(bob), 500_001 ether);
    }

    function nextBlock() internal {
        hevm.roll(block.number + 1);
    }

    function set_x(uint _x) public {
        require(msg.sender == address(timelock));
        x = _x;
    }

    function test_Delegate(uint96 a, uint96 b, uint96 c, address d, address e) public {
        if (a > 100000000 ether) return;
        if (uint(b) + uint(c) > uint(a)) return;
        if (d == address(0) || e == address(0)) return;
        rad.transfer(address(usr), a);
        usr.delegate(address(usr)); // delegating to self should be a noop
        usr.delegate(d);
        nextBlock();
        assertEq(uint(rad.getCurrentVotes(address(d))), a);
        usr.transfer(e, b);
        nextBlock();
        assertEq(uint(rad.getCurrentVotes(address(d))), a - b);
        usr.burn(c);
        nextBlock();
        assertEq(uint(rad.getPriorVotes(address(d), block.number - 3)), a);
        assertEq(uint(rad.getPriorVotes(address(d), block.number - 2)), a - b);
        assertEq(uint(rad.getPriorVotes(address(d), block.number - 1)), a - b - c);
        assertEq(uint(rad.getCurrentVotes(address(d))), a - b - c);
    }

    function test_propose() public {
        uint proposals = gov.proposalCount();
        ali.delegate(address(bob));
        bob.delegate(address(bob));
        nextBlock();
        bob.propose(address(this), "set_x(uint256)", abi.encode(uint(1)));
        assertEq(gov.proposalCount(), proposals + 1);
    }
}

library Utils {
    function create2Address(
        bytes32 salt, address creator, bytes memory creationCode, bytes memory args
    ) internal pure returns (address) {
        return address(uint(keccak256(abi.encodePacked(
            bytes1(0xff),
            creator,
            salt,
            keccak256(abi.encodePacked(creationCode, args))
        ))));
    }

    function mkVestingToken(
        address token,
        address owner,
        address beneficiary,
        uint amount,
        uint vestingStartTime,
        uint vestingPeriod,
        uint cliffPeriod
    ) internal returns (VestingToken) {
        bytes32 salt = bytes32("0xacab");

        address vestAddress = Utils.create2Address(
            salt,
            address(this),
            type(VestingToken).creationCode,
            abi.encode(
                token, owner, beneficiary, amount, vestingStartTime, vestingPeriod, cliffPeriod
            )
        );

        RadicleToken(token).approve(vestAddress, uint(-1));
        VestingToken vest = new VestingToken{salt: salt}(
            token, owner, beneficiary, amount, vestingStartTime, vestingPeriod, cliffPeriod
        );

        return vest;
    }

    function asBytes32(address addr) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(addr)));
    }

    function namehash(string[] memory domain) internal pure returns (bytes32) {
        if (domain.length == 0) {
            return bytes32(uint(0));
        }
        if (domain.length == 1) {
            return keccak256(abi.encodePacked(bytes32(0), keccak256(bytes(domain[0]))));
        }
        else {
            bytes memory label = bytes(domain[0]);
            string[] memory remainder = new string[](domain.length - 1);
            for (uint i = 1; i < domain.length; i++) {
                remainder[i - 1] = domain[i];
            }
            return keccak256(abi.encodePacked(namehash(remainder), keccak256(label)));
        }
    }

    function namehash(string[1] memory domain) internal pure returns (bytes32) {
        string[] memory dyn = new string[](1);
        dyn[0] = domain[0];
        return namehash(dyn);
    }
    function namehash(string[2] memory domain) internal pure returns (bytes32) {
        string[] memory dyn = new string[](domain.length);
        for (uint i; i < domain.length; i++) {
            dyn[i] = domain[i];
        }
        return namehash(dyn);
    }
    function namehash(string[3] memory domain) internal pure returns (bytes32) {
        string[] memory dyn = new string[](domain.length);
        for (uint i; i < domain.length; i++) {
            dyn[i] = domain[i];
        }
        return namehash(dyn);
    }
    function namehash(string[4] memory domain) internal pure returns (bytes32) {
        string[] memory dyn = new string[](domain.length);
        for (uint i; i < domain.length; i++) {
            dyn[i] = domain[i];
        }
        return namehash(dyn);
    }
    function namehash(string[5] memory domain) internal pure returns (bytes32) {
        string[] memory dyn = new string[](domain.length);
        for (uint i; i < domain.length; i++) {
            dyn[i] = domain[i];
        }
        return namehash(dyn);
    }
}
