import { ethers } from "hardhat";
import { assert } from "chai";
import { utils } from "ethers";
import { submit, elapseTime, mineBlocks } from "./support";
import { deployAll } from "../src/deploy";

describe("Registrar", function () {
  it("should allow registration of names with Radicle tokens", async function () {
    const [owner, registrant] = await ethers.getSigners();
    const { rad, registrar, ens } = await deployAll(owner);
    const registrantAddr = await registrant.getAddress();

    // Let 24 hours pass. This is the minimum to ensure we have a price
    // for our token pairs.
    await elapseTime(60 * 60 * 24);

    const fee = await registrar.registrationFeeRad();
    const initialSupply = await rad.totalSupply();

    assert(fee.gt(0), "Fee must be > 0");

    await rad.connect(owner).transfer(registrantAddr, fee);
    await rad.connect(registrant).approve(registrar.address, fee);

    // Check name availability.
    assert(await registrar.available("cloudhead"));
    assert(await registrar.available("treehead"));

    // Commit to `cloudhead.radicle.eth`.
    const label = utils.toUtf8Bytes("cloudhead");
    const secret = ethers.utils.randomBytes(32);
    const commitment = utils.keccak256(utils.concat([label, registrantAddr, secret]));
    await submit(registrar.connect(registrant).commit(commitment));
    await mineBlocks(50);
    await submit(registrar.connect(registrant).register("cloudhead", registrantAddr, secret));
    assert.equal(await ens.owner(ethers.utils.namehash("cloudhead.radicle.eth")), registrantAddr);
    assert(!(await registrar.available("cloudhead")));

    // Check that the burn happened.
    const newSupply = await rad.totalSupply();
    assert(initialSupply.sub(newSupply).eq(fee));
    assert((await rad.balanceOf(registrantAddr)).eq(0));
  });

  it("should allow fees to be updated", async function () {
    const [owner, registrant] = await ethers.getSigners();
    const { rad, registrar } = await deployAll(owner);
    const registrantAddr = await registrant.getAddress();

    await rad.connect(owner).transfer(registrantAddr, 100);

    const fee = await registrar.registrationFeeRad();

    await submit(registrar.connect(owner).setRadRegistrationFee(fee.mul(2)));

    const newFee = await registrar.registrationFeeRad();

    assert(newFee.eq(fee.mul(2)));
  });

  it("should allow the domain owner to be updated", async function () {
    const [owner, newOwner] = await ethers.getSigners();
    const { ens, registrar } = await deployAll(owner);
    const newOwnerAddr = await newOwner.getAddress();

    assert.equal(await ens.owner(ethers.utils.namehash("radicle.eth")), registrar.address);
    await submit(registrar.connect(owner).setDomainOwner(newOwnerAddr));

    assert.equal(await ens.owner(ethers.utils.namehash("radicle.eth")), newOwnerAddr);
  });
});
