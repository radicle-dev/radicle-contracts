import { ethers } from "hardhat";
import { assert } from "chai";
import {
  Proxy__factory,
  DummyUpgradableV1__factory,
  DummyUpgradableV2__factory,
} from "../contract-bindings/ethers";
import { submit } from "./support";

describe("Proxy", function () {
  it("it should delegate calls to the target contract", async function () {
    const [admin, user] = await ethers.getSigners();
    const adminAddr = await admin.getAddress();

    const contract1 = await new DummyUpgradableV1__factory(admin).deploy();
    const contract2 = await new DummyUpgradableV2__factory(admin).deploy();

    assert.equal((await contract1.version()).toNumber(), 1);
    assert.equal((await contract2.version()).toNumber(), 2);

    const proxy = await new Proxy__factory(admin).deploy(adminAddr);

    assert.equal(await proxy.admin(), adminAddr);
    assert.equal(await proxy.pendingImplementation(), ethers.constants.AddressZero);
    assert.equal(await proxy.implementation(), ethers.constants.AddressZero);

    // Create a new instance of the contract, attached to the proxy.
    const impl = contract1.attach(proxy.address);

    assert.equal(await proxy.implementation(), ethers.constants.AddressZero);

    await submit(proxy._setPendingImplementation(contract1.address));
    await submit(contract1.upgrade(proxy.address));

    assert.equal(await proxy.implementation(), contract1.address);
    assert.equal((await contract1.version()).toNumber(), 1);
    assert.equal((await impl.connect(user).version()).toNumber(), 1);

    await submit(proxy._setPendingImplementation(contract2.address));
    await submit(contract2.upgrade(proxy.address));

    assert.equal(await proxy.implementation(), contract2.address);
    assert.equal((await impl.connect(user).version()).toNumber(), 2);
  });
});
