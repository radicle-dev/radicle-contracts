// radicle.eth = 0x1e8e223921cb10fa256008149efd13dc5089bb252c6270e8be840a020e2e6416
// cloudhead.radicle.eth = 0x567c364804de7bbedb53f583e483f6b73513fd2f44299e281024e4719da0b332
// treehead.radicle.eth = 0x151be02f47af592d39e263c0a38443a2da15cdffcaf1e57ab2be0c047c88a4a1

import {ethers} from "@nomiclabs/buidler";
import {assert} from "chai";
import {submit} from "./support";

describe("Registrar", function () {
  it("should allow registration of names", async function () {
    const [owner, registrant] = await ethers.getSigners();
    const ownerAddr = await owner.getAddress();

    var zeroNode =
      "0x0000000000000000000000000000000000000000000000000000000000000000";
    var radicleNode =
      "0x1e8e223921cb10fa256008149efd13dc5089bb252c6270e8be840a020e2e6416";

    var ethLabel = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("eth"));
    var radicleLabel = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes("radicle")
    );
    var cloudheadLabel = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes("cloudhead")
    );

    const Oracle = await ethers.getContractFactory("DummyPriceOracle");
    const oracle = await Oracle.connect(owner).deploy(1);

    const ENS = await ethers.getContractFactory("DummyEnsRegistry");
    const ens = await ENS.connect(owner).deploy();

    const Registrar = await ethers.getContractFactory("Registrar");
    const registrar = await Registrar.connect(owner).deploy(
      ens.address,
      radicleNode,
      oracle.address
    );

    await oracle.deployed();
    await ens.deployed();
    await registrar.deployed();

    const ethNode = await registrar.namehash(zeroNode, ethLabel);
    const cloudheadNode = await registrar.namehash(radicleNode, cloudheadLabel);
    const registrantAddr = await registrant.getAddress();
    const fee = (await registrar.registrationFee()).toNumber();

    // Create the `.eth` node, with `owner` as its owner.
    await submit(
      ens.connect(owner).setSubnodeOwner(zeroNode, ethLabel, ownerAddr)
    );
    assert.equal(await ens.owner(ethNode), ownerAddr);

    // Create `radicle.eth`.
    await submit(
      ens
        .connect(owner)
        .setSubnodeOwner(ethNode, radicleLabel, registrar.address)
    );
    assert.equal(await ens.owner(radicleNode), registrar.address);

    // Check name availability.
    assert(await registrar.available("cloudhead"));
    assert(await registrar.available("treehead"));

    // Register `cloudhead.radicle.eth`.
    await submit(
      registrar
        .connect(owner)
        .register("cloudhead", registrantAddr, {value: fee})
    );
    assert.equal(await ens.owner(cloudheadNode), registrantAddr);
    assert(!(await registrar.available("cloudhead")));
  });
});
