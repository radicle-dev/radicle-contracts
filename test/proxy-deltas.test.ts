import { ProxyDeltasTest__factory } from "../contract-bindings/ethers";
import { ProxyDeltasTest } from "../contract-bindings/ethers/ProxyDeltasTest";
import { ethers } from "hardhat";
import { BigNumber, BigNumberish } from "ethers";
import { assert } from "chai";
import { submitFailing } from "./support";

async function deployProxyDeltasTest(): Promise<ProxyDeltasTest> {
  const [signer] = await ethers.getSigners();
  const deltasTest = await new ProxyDeltasTest__factory(signer).deploy();
  return await deltasTest.deployed();
}

async function expectAddToDeltasWithInvalidCycleReverts(
  deltasTest: ProxyDeltasTest,
  finishedCycle: BigNumberish,
  deltas: {
    cycle: BigNumberish;
    thisCycleDelta: BigNumberish;
    nextCycleDelta: BigNumberish;
  }[]
): Promise<void> {
  await submitFailing(
    deltasTest.addToDeltas(finishedCycle, deltas),
    "addToDeltas",
    "Invalid cycle number"
  );
}

describe("ProxyDeltas", function () {
  it("Is empty on the beginning", async function () {
    const deltasTest = await deployProxyDeltasTest();

    await deltasTest.addToDeltas(0, []);

    const deltas = await deltasTest.getProxyDeltasIterated();
    assert(deltas.length == 0);
  });

  it("Keeps a single added item", async function () {
    const deltasTest = await deployProxyDeltasTest();

    await deltasTest.addToDeltas(0, [{ cycle: 1, thisCycleDelta: 1, nextCycleDelta: 0 }]);

    const deltas = await deltasTest.getProxyDeltasIterated();
    assert(deltas.length == 1);
    assert(deltas[0].cycle.eq(1));
    assert(deltas[0].thisCycleDelta.eq(1));
    assert(deltas[0].nextCycleDelta.eq(0));
  });

  it("Keeps multiple added items", async function () {
    const deltasTest = await deployProxyDeltasTest();

    await deltasTest.addToDeltas(0, [
      { cycle: 1, thisCycleDelta: 1, nextCycleDelta: 0 },
      { cycle: 2, thisCycleDelta: 2, nextCycleDelta: 0 },
      { cycle: 3, thisCycleDelta: 4, nextCycleDelta: 0 },
    ]);

    const deltas = await deltasTest.getProxyDeltasIterated();
    assert(deltas.length == 3);
    assert(deltas[0].cycle.eq(3));
    assert(deltas[0].thisCycleDelta.eq(4));
    assert(deltas[0].nextCycleDelta.eq(0));
    assert(deltas[1].cycle.eq(2));
    assert(deltas[1].thisCycleDelta.eq(2));
    assert(deltas[1].nextCycleDelta.eq(0));
    assert(deltas[2].cycle.eq(1));
    assert(deltas[2].thisCycleDelta.eq(1));
    assert(deltas[2].nextCycleDelta.eq(0));
  });

  it("Allows removing the last item", async function () {
    const deltasTest = await deployProxyDeltasTest();

    await deltasTest.addToDeltas(0, [
      { cycle: 1, thisCycleDelta: 1, nextCycleDelta: 0 },
      { cycle: 2, thisCycleDelta: 2, nextCycleDelta: 0 },
      { cycle: 3, thisCycleDelta: 4, nextCycleDelta: 0 },
      { cycle: 1, thisCycleDelta: -1, nextCycleDelta: 0 },
    ]);

    const deltas = await deltasTest.getProxyDeltasIterated();
    assert(deltas.length == 2);
    assert(deltas[0].cycle.eq(3));
    assert(deltas[0].thisCycleDelta.eq(4));
    assert(deltas[0].nextCycleDelta.eq(0));
    assert(deltas[1].cycle.eq(2));
    assert(deltas[1].thisCycleDelta.eq(2));
    assert(deltas[1].nextCycleDelta.eq(0));
  });

  it("Allows removing two last items", async function () {
    const deltasTest = await deployProxyDeltasTest();

    await deltasTest.addToDeltas(0, [
      { cycle: 1, thisCycleDelta: 1, nextCycleDelta: 0 },
      { cycle: 2, thisCycleDelta: 2, nextCycleDelta: 0 },
      { cycle: 3, thisCycleDelta: 4, nextCycleDelta: 0 },
      { cycle: 1, thisCycleDelta: -1, nextCycleDelta: 0 },
      { cycle: 2, thisCycleDelta: -2, nextCycleDelta: 0 },
    ]);

    const deltas = await deltasTest.getProxyDeltasIterated();
    assert(deltas.length == 1);
    assert(deltas[0].cycle.eq(3));
    assert(deltas[0].thisCycleDelta.eq(4));
    assert(deltas[0].nextCycleDelta.eq(0));
  });

  it("Allows removing the first item", async function () {
    const deltasTest = await deployProxyDeltasTest();

    await deltasTest.addToDeltas(0, [
      { cycle: 1, thisCycleDelta: 1, nextCycleDelta: 0 },
      { cycle: 2, thisCycleDelta: 2, nextCycleDelta: 0 },
      { cycle: 3, thisCycleDelta: 4, nextCycleDelta: 0 },
      { cycle: 3, thisCycleDelta: -4, nextCycleDelta: 0 },
    ]);

    const deltas = await deltasTest.getProxyDeltasIterated();
    assert(deltas.length == 2);
    assert(deltas[0].cycle.eq(2));
    assert(deltas[0].thisCycleDelta.eq(2));
    assert(deltas[0].nextCycleDelta.eq(0));
    assert(deltas[1].cycle.eq(1));
    assert(deltas[1].thisCycleDelta.eq(1));
    assert(deltas[1].nextCycleDelta.eq(0));
  });

  it("Allows removing two first items", async function () {
    const deltasTest = await deployProxyDeltasTest();

    await deltasTest.addToDeltas(0, [
      { cycle: 1, thisCycleDelta: 1, nextCycleDelta: 0 },
      { cycle: 2, thisCycleDelta: 2, nextCycleDelta: 0 },
      { cycle: 3, thisCycleDelta: 4, nextCycleDelta: 0 },
      { cycle: 2, thisCycleDelta: -2, nextCycleDelta: 0 },
      { cycle: 3, thisCycleDelta: -4, nextCycleDelta: 0 },
    ]);

    const deltas = await deltasTest.getProxyDeltasIterated();
    assert(deltas.length == 1);
    assert(deltas[0].cycle.eq(1));
    assert(deltas[0].thisCycleDelta.eq(1));
    assert(deltas[0].nextCycleDelta.eq(0));
  });

  it("Allows removing the middle item", async function () {
    const deltasTest = await deployProxyDeltasTest();

    await deltasTest.addToDeltas(0, [
      { cycle: 1, thisCycleDelta: 1, nextCycleDelta: 0 },
      { cycle: 2, thisCycleDelta: 2, nextCycleDelta: 0 },
      { cycle: 3, thisCycleDelta: 4, nextCycleDelta: 0 },
      { cycle: 2, thisCycleDelta: -2, nextCycleDelta: 0 },
    ]);

    const deltas = await deltasTest.getProxyDeltasIterated();
    assert(deltas.length == 2);
    assert(deltas[0].cycle.eq(3));
    assert(deltas[0].thisCycleDelta.eq(4));
    assert(deltas[0].nextCycleDelta.eq(0));
    assert(deltas[1].cycle.eq(1));
    assert(deltas[1].thisCycleDelta.eq(1));
    assert(deltas[1].nextCycleDelta.eq(0));
  });

  it("Allows removing two middle items", async function () {
    const deltasTest = await deployProxyDeltasTest();

    await deltasTest.addToDeltas(0, [
      { cycle: 1, thisCycleDelta: 1, nextCycleDelta: 0 },
      { cycle: 2, thisCycleDelta: 2, nextCycleDelta: 0 },
      { cycle: 3, thisCycleDelta: 4, nextCycleDelta: 0 },
      { cycle: 4, thisCycleDelta: 8, nextCycleDelta: 0 },
      { cycle: 2, thisCycleDelta: -2, nextCycleDelta: 0 },
      { cycle: 3, thisCycleDelta: -4, nextCycleDelta: 0 },
    ]);

    const deltas = await deltasTest.getProxyDeltasIterated();
    assert(deltas.length == 2);
    assert(deltas[0].cycle.eq(4));
    assert(deltas[0].thisCycleDelta.eq(8));
    assert(deltas[0].nextCycleDelta.eq(0));
    assert(deltas[1].cycle.eq(1));
    assert(deltas[1].thisCycleDelta.eq(1));
    assert(deltas[1].nextCycleDelta.eq(0));
  });

  it("Allows removing all items", async function () {
    const deltasTest = await deployProxyDeltasTest();

    await deltasTest.addToDeltas(0, [
      { cycle: 1, thisCycleDelta: 1, nextCycleDelta: 0 },
      { cycle: 2, thisCycleDelta: 2, nextCycleDelta: 0 },
      { cycle: 3, thisCycleDelta: 4, nextCycleDelta: 0 },
      { cycle: 1, thisCycleDelta: -1, nextCycleDelta: 0 },
      { cycle: 2, thisCycleDelta: -2, nextCycleDelta: 0 },
      { cycle: 3, thisCycleDelta: -4, nextCycleDelta: 0 },
    ]);

    const deltas = await deltasTest.getProxyDeltasIterated();
    assert(deltas.length == 0);
  });

  it("Allows adding items after removing all items", async function () {
    // Add an item and then clear the list
    const deltasTest = await deployProxyDeltasTest();

    await deltasTest.addToDeltas(0, [
      { cycle: 1, thisCycleDelta: 1, nextCycleDelta: 0 },
      { cycle: 1, thisCycleDelta: -1, nextCycleDelta: 0 },
    ]);

    let deltas = await deltasTest.getProxyDeltasIterated();
    assert(deltas.length == 0);

    // Add an item
    await deltasTest.addToDeltas(0, [{ cycle: 1, thisCycleDelta: 2, nextCycleDelta: 0 }]);

    deltas = await deltasTest.getProxyDeltasIterated();
    assert(deltas.length == 1);
    assert(deltas[0].cycle.eq(1));
    assert(deltas[0].thisCycleDelta.eq(2));
    assert(deltas[0].nextCycleDelta.eq(0));
  });

  it("Allows updating the first item", async function () {
    const deltasTest = await deployProxyDeltasTest();

    await deltasTest.addToDeltas(0, [
      { cycle: 1, thisCycleDelta: 1, nextCycleDelta: 0 },
      { cycle: 2, thisCycleDelta: 2, nextCycleDelta: 0 },
      { cycle: 3, thisCycleDelta: 4, nextCycleDelta: 0 },
      { cycle: 3, thisCycleDelta: 8, nextCycleDelta: 0 },
    ]);

    const deltas = await deltasTest.getProxyDeltasIterated();
    assert(deltas.length == 3);
    assert(deltas[0].cycle.eq(3));
    assert(deltas[0].thisCycleDelta.eq(12));
    assert(deltas[0].nextCycleDelta.eq(0));
    assert(deltas[1].cycle.eq(2));
    assert(deltas[1].thisCycleDelta.eq(2));
    assert(deltas[1].nextCycleDelta.eq(0));
    assert(deltas[2].cycle.eq(1));
    assert(deltas[2].thisCycleDelta.eq(1));
    assert(deltas[2].nextCycleDelta.eq(0));
  });

  it("Allows updating the middle item", async function () {
    const deltasTest = await deployProxyDeltasTest();

    await deltasTest.addToDeltas(0, [
      { cycle: 1, thisCycleDelta: 1, nextCycleDelta: 0 },
      { cycle: 2, thisCycleDelta: 2, nextCycleDelta: 0 },
      { cycle: 3, thisCycleDelta: 4, nextCycleDelta: 0 },
      { cycle: 2, thisCycleDelta: 8, nextCycleDelta: 0 },
    ]);

    const deltas = await deltasTest.getProxyDeltasIterated();
    assert(deltas.length == 3);
    assert(deltas[0].cycle.eq(3));
    assert(deltas[0].thisCycleDelta.eq(4));
    assert(deltas[0].nextCycleDelta.eq(0));
    assert(deltas[1].cycle.eq(2));
    assert(deltas[1].thisCycleDelta.eq(10));
    assert(deltas[1].nextCycleDelta.eq(0));
    assert(deltas[2].cycle.eq(1));
    assert(deltas[2].thisCycleDelta.eq(1));
    assert(deltas[2].nextCycleDelta.eq(0));
  });

  it("Allows updating the last item", async function () {
    const deltasTest = await deployProxyDeltasTest();

    await deltasTest.addToDeltas(0, [
      { cycle: 1, thisCycleDelta: 1, nextCycleDelta: 0 },
      { cycle: 2, thisCycleDelta: 2, nextCycleDelta: 0 },
      { cycle: 3, thisCycleDelta: 4, nextCycleDelta: 0 },
      { cycle: 1, thisCycleDelta: 8, nextCycleDelta: 0 },
    ]);

    const deltas = await deltasTest.getProxyDeltasIterated();
    assert(deltas.length == 3);
    assert(deltas[0].cycle.eq(3));
    assert(deltas[0].thisCycleDelta.eq(4));
    assert(deltas[0].nextCycleDelta.eq(0));
    assert(deltas[1].cycle.eq(2));
    assert(deltas[1].thisCycleDelta.eq(2));
    assert(deltas[1].nextCycleDelta.eq(0));
    assert(deltas[2].cycle.eq(1));
    assert(deltas[2].thisCycleDelta.eq(9));
    assert(deltas[2].nextCycleDelta.eq(0));
  });

  it("Rejects adding delta for cycle 0", async function () {
    const deltasTest = await deployProxyDeltasTest();
    await expectAddToDeltasWithInvalidCycleReverts(deltasTest, 0, [
      { cycle: 0, thisCycleDelta: 1, nextCycleDelta: 0 },
    ]);
  });

  it("Rejects adding delta for cycle uint64 max", async function () {
    const deltasTest = await deployProxyDeltasTest();
    const uint64Max = BigNumber.from(2).pow(64).sub(1);
    await expectAddToDeltasWithInvalidCycleReverts(deltasTest, 0, [
      { cycle: uint64Max, thisCycleDelta: 1, nextCycleDelta: 0 },
    ]);
  });

  it("Keeps items with only next delta set", async function () {
    const deltasTest = await deployProxyDeltasTest();

    await deltasTest.addToDeltas(0, [{ cycle: 1, thisCycleDelta: 0, nextCycleDelta: 1 }]);

    const deltas = await deltasTest.getProxyDeltasIterated();
    assert(deltas.length == 1);
    assert(deltas[0].cycle.eq(1));
    assert(deltas[0].thisCycleDelta.eq(0));
    assert(deltas[0].nextCycleDelta.eq(1));
  });

  it("Allows removing items with only next delta set", async function () {
    const deltasTest = await deployProxyDeltasTest();

    await deltasTest.addToDeltas(0, [
      { cycle: 1, thisCycleDelta: 0, nextCycleDelta: 1 },
      { cycle: 2, thisCycleDelta: 0, nextCycleDelta: 2 },
      { cycle: 1, thisCycleDelta: 0, nextCycleDelta: -1 },
    ]);

    const deltas = await deltasTest.getProxyDeltasIterated();
    assert(deltas.length == 1);
    assert(deltas[0].cycle.eq(2));
    assert(deltas[0].thisCycleDelta.eq(0));
    assert(deltas[0].nextCycleDelta.eq(2));
  });

  it("Removes obsolete items", async function () {
    const deltasTest = await deployProxyDeltasTest();

    await deltasTest.addToDeltas(3, [
      { cycle: 1, thisCycleDelta: 1, nextCycleDelta: 0 },
      { cycle: 2, thisCycleDelta: 2, nextCycleDelta: 0 },
      { cycle: 3, thisCycleDelta: 4, nextCycleDelta: 0 },
      { cycle: 4, thisCycleDelta: 8, nextCycleDelta: 0 },
      { cycle: 5, thisCycleDelta: 16, nextCycleDelta: 0 },
    ]);

    const deltas = await deltasTest.getProxyDeltasIterated();
    assert(deltas.length == 3);
    assert(deltas[0].cycle.eq(5));
    assert(deltas[0].thisCycleDelta.eq(16));
    assert(deltas[0].nextCycleDelta.eq(0));
    assert(deltas[1].cycle.eq(4));
    assert(deltas[1].thisCycleDelta.eq(8));
    assert(deltas[1].nextCycleDelta.eq(0));
    assert(deltas[2].cycle.eq(3));
    assert(deltas[2].thisCycleDelta.eq(4));
    assert(deltas[2].nextCycleDelta.eq(0));
  });
});
