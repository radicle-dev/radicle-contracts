import {ethers} from "@nomiclabs/buidler";
import {assert} from "chai";
import {submit, elapseTime} from "./support";
import {deployAll} from "../src/deploy";
import * as ensUtils from "../src/ens";

describe("Registrar", function () {
  it("should allow registration of names", async function () {
    const [owner, registrant] = await ethers.getSigners();
    const {rad, registrar, ens} = await deployAll(ethers.provider, owner);
    const registrantAddr = await registrant.getAddress();

    // Let 24 hours pass. This is the minimum to ensure we have a price
    // for our token pairs.
    await elapseTime(60 * 60 * 24);

    // Initialize the registrar.
    await submit(registrar.initialize());

    const fee = (await registrar.registrationFee()).toNumber();
    const initialSupply = await rad.totalSupply();

    assert(fee > 0, "Fee must be > 0");

    // Check name availability.
    assert(await registrar.available("cloudhead"));
    assert(await registrar.available("treehead"));

    // Register `cloudhead.radicle.eth`.
    await submit(registrar.register("cloudhead", registrantAddr, {value: fee}));
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
});
