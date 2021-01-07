import { ethers } from "hardhat";
import { assert } from "chai";
import { submit, elapseTime } from "./support";
import { deployAll } from "../src/deploy";
import * as ensUtils from "../src/ens";

describe("Registrar", function () {
  it("should allow registration of names", async function () {
    const [owner, registrant] = await ethers.getSigners();
    const { rad, registrar, ens } = await deployAll(owner);
    const registrantAddr = await registrant.getAddress();

    // Let 24 hours pass. This is the minimum to ensure we have a price
    // for our token pairs.
    await elapseTime(60 * 60 * 24);

    // Initialize the registrar.
    await submit(registrar.initialize());

    const fee = (await registrar.registrationFeeEth()).toNumber();
    const initialSupply = await rad.totalSupply();

    assert(fee > 0, "Fee must be > 0");

    // Check name availability.
    assert(await registrar.available("cloudhead"));
    assert(await registrar.available("treehead"));

    // Register `cloudhead.radicle.eth`.
    await submit(
      registrar.registerEth("cloudhead", registrantAddr, { value: fee })
    );
    assert.equal(
      await ens.owner(ensUtils.nameHash("cloudhead.radicle.eth")),
      registrantAddr
    );
    assert(!(await registrar.available("cloudhead")));

    // Check that the burn happened. The exact amount swapped is always slightly
    // lower than the exact conversion.
    const newSupply = await rad.totalSupply();
    assert.equal(newSupply.sub(initialSupply).toNumber(), -(fee - 1));
  });

  it("should allow fees to be updated", async function () {
    const [owner, registrant] = await ethers.getSigners();
    const { rad, registrar } = await deployAll(owner);
    const registrantAddr = await registrant.getAddress();

    rad.connect(owner).transfer(registrantAddr, 100);

    const fee = (await registrar.registrationFeeRad()).toNumber();

    await submit(registrar.connect(owner).setRadRegistrationFee(fee * 2));

    const newFee = (await registrar.registrationFeeRad()).toNumber();

    assert.equal(newFee, fee * 2);
  });
});
