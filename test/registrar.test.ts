import {ethers} from "@nomiclabs/buidler";
import {assert} from "chai";
import {submit} from "./support";
import {deployDev} from "../src/deploy";
import * as ensUtils from "../src/ens";

describe("Registrar", function () {
  it("should allow registration of names", async function () {
    const [owner, registrant] = await ethers.getSigners();
    const {rad, registrar, ens} = await deployDev(owner);
    const registrantAddr = await registrant.getAddress();
    const fee = (await registrar.registrationFee()).toNumber();
    const initialSupply = await rad.totalSupply();

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

    // Check that the burn happened.
    const newSupply = await rad.totalSupply();
    assert.equal(newSupply.sub(initialSupply).toNumber(), -fee);
  });
});
