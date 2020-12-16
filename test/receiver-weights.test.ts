import {
  ReceiverWeightsTest,
  ReceiverWeightsTest__factory,
} from "../contract-bindings/ethers";
import { ethers } from "hardhat";
import { BigNumberish } from "ethers";
import { assert } from "chai";
import { numberToAddress, randomAddresses, submitFailing } from "./support";

async function deployReceiverWeightsTest(): Promise<ReceiverWeightsTest> {
  const [signer] = await ethers.getSigners();
  const weightsTest = await new ReceiverWeightsTest__factory(signer).deploy();
  return await weightsTest.deployed();
}

async function expectSetWeightsWithInvalidAddressReverts(
  weightsTest: ReceiverWeightsTest,
  weights: {
    receiver: string;
    weightReceiver: BigNumberish;
    weightProxy: BigNumberish;
  }[]
): Promise<void> {
  await submitFailing(
    weightsTest.setWeights(weights),
    "setWeights",
    "Invalid receiver address"
  );
}

describe("ReceiverWeights", function () {
  it("Is empty on the beginning", async function () {
    const weightsTest = await deployReceiverWeightsTest();

    await weightsTest.setWeights([]);

    assert((await weightsTest.weightReceiverSumDelta()).eq(0));
    assert((await weightsTest.weightProxySumDelta()).eq(0));
    const weights = await weightsTest.getReceiverWeightsIterated();
    assert(weights.length == 0);
  });

  it("Keeps a single added item", async function () {
    const weightsTest = await deployReceiverWeightsTest();
    const [addr1] = randomAddresses();

    await weightsTest.setWeights([
      { receiver: addr1, weightReceiver: 1, weightProxy: 0 },
    ]);

    assert((await weightsTest.weightReceiverSumDelta()).eq(1));
    assert((await weightsTest.weightProxySumDelta()).eq(0));
    const weights = await weightsTest.getReceiverWeightsIterated();
    assert(weights.length == 1);
    assert(weights[0].receiver == addr1);
    assert(weights[0].weightReceiver == 1);
    assert(weights[0].weightProxy == 0);
  });

  it("Keeps multiple added items", async function () {
    const weightsTest = await deployReceiverWeightsTest();
    const [addr1, addr2, addr3] = randomAddresses();

    await weightsTest.setWeights([
      { receiver: addr1, weightReceiver: 1, weightProxy: 0 },
      { receiver: addr2, weightReceiver: 2, weightProxy: 0 },
      { receiver: addr3, weightReceiver: 4, weightProxy: 0 },
    ]);

    assert((await weightsTest.weightReceiverSumDelta()).eq(1 + 2 + 4));
    assert((await weightsTest.weightProxySumDelta()).eq(0));
    const weights = await weightsTest.getReceiverWeightsIterated();
    assert(weights.length == 3);
    assert(weights[0].receiver == addr3);
    assert(weights[0].weightReceiver == 4);
    assert(weights[0].weightProxy == 0);
    assert(weights[1].receiver == addr2);
    assert(weights[1].weightReceiver == 2);
    assert(weights[1].weightProxy == 0);
    assert(weights[2].receiver == addr1);
    assert(weights[2].weightReceiver == 1);
    assert(weights[2].weightProxy == 0);
  });

  it("Allows removing the last item", async function () {
    const weightsTest = await deployReceiverWeightsTest();
    const [addr1, addr2, addr3] = randomAddresses();

    await weightsTest.setWeights([
      { receiver: addr1, weightReceiver: 1, weightProxy: 0 },
      { receiver: addr2, weightReceiver: 2, weightProxy: 0 },
      { receiver: addr3, weightReceiver: 4, weightProxy: 0 },
      { receiver: addr1, weightReceiver: 0, weightProxy: 0 },
    ]);

    assert((await weightsTest.weightReceiverSumDelta()).eq(1 + 2 + 4 - 1));
    assert((await weightsTest.weightProxySumDelta()).eq(0));
    const weights = await weightsTest.getReceiverWeightsIterated();
    assert(weights.length == 2);
    assert(weights[0].receiver == addr3);
    assert(weights[0].weightReceiver == 4);
    assert(weights[0].weightProxy == 0);
    assert(weights[1].receiver == addr2);
    assert(weights[1].weightReceiver == 2);
    assert(weights[1].weightProxy == 0);
  });

  it("Allows removing two last items", async function () {
    const weightsTest = await deployReceiverWeightsTest();
    const [addr1, addr2, addr3] = randomAddresses();

    await weightsTest.setWeights([
      { receiver: addr1, weightReceiver: 1, weightProxy: 0 },
      { receiver: addr2, weightReceiver: 2, weightProxy: 0 },
      { receiver: addr3, weightReceiver: 4, weightProxy: 0 },
      { receiver: addr1, weightReceiver: 0, weightProxy: 0 },
      { receiver: addr2, weightReceiver: 0, weightProxy: 0 },
    ]);

    assert((await weightsTest.weightReceiverSumDelta()).eq(1 + 2 + 4 - 1 - 2));
    assert((await weightsTest.weightProxySumDelta()).eq(0));
    const weights = await weightsTest.getReceiverWeightsIterated();
    assert(weights.length == 1);
    assert(weights[0].receiver == addr3);
    assert(weights[0].weightReceiver == 4);
    assert(weights[0].weightProxy == 0);
  });

  it("Allows removing the first item", async function () {
    const weightsTest = await deployReceiverWeightsTest();
    const [addr1, addr2, addr3] = randomAddresses();

    await weightsTest.setWeights([
      { receiver: addr1, weightReceiver: 1, weightProxy: 0 },
      { receiver: addr2, weightReceiver: 2, weightProxy: 0 },
      { receiver: addr3, weightReceiver: 4, weightProxy: 0 },
      { receiver: addr3, weightReceiver: 0, weightProxy: 0 },
    ]);

    assert((await weightsTest.weightReceiverSumDelta()).eq(1 + 2 + 4 - 4));
    assert((await weightsTest.weightProxySumDelta()).eq(0));
    const weights = await weightsTest.getReceiverWeightsIterated();
    assert(weights.length == 2);
    assert(weights[0].receiver == addr2);
    assert(weights[0].weightReceiver == 2);
    assert(weights[0].weightProxy == 0);
    assert(weights[1].receiver == addr1);
    assert(weights[1].weightReceiver == 1);
    assert(weights[1].weightProxy == 0);
  });

  it("Allows removing two first items", async function () {
    const weightsTest = await deployReceiverWeightsTest();
    const [addr1, addr2, addr3] = randomAddresses();

    await weightsTest.setWeights([
      { receiver: addr1, weightReceiver: 1, weightProxy: 0 },
      { receiver: addr2, weightReceiver: 2, weightProxy: 0 },
      { receiver: addr3, weightReceiver: 4, weightProxy: 0 },
      { receiver: addr2, weightReceiver: 0, weightProxy: 0 },
      { receiver: addr3, weightReceiver: 0, weightProxy: 0 },
    ]);

    assert((await weightsTest.weightReceiverSumDelta()).eq(1 + 2 + 4 - 2 - 4));
    assert((await weightsTest.weightProxySumDelta()).eq(0));
    const weights = await weightsTest.getReceiverWeightsIterated();
    assert(weights.length == 1);
    assert(weights[0].receiver == addr1);
    assert(weights[0].weightReceiver == 1);
    assert(weights[0].weightProxy == 0);
  });

  it("Allows removing the middle item", async function () {
    const weightsTest = await deployReceiverWeightsTest();
    const [addr1, addr2, addr3] = randomAddresses();

    await weightsTest.setWeights([
      { receiver: addr1, weightReceiver: 1, weightProxy: 0 },
      { receiver: addr2, weightReceiver: 2, weightProxy: 0 },
      { receiver: addr3, weightReceiver: 4, weightProxy: 0 },
      { receiver: addr2, weightReceiver: 0, weightProxy: 0 },
    ]);

    assert((await weightsTest.weightReceiverSumDelta()).eq(1 + 2 + 4 - 2));
    assert((await weightsTest.weightProxySumDelta()).eq(0));
    const weights = await weightsTest.getReceiverWeightsIterated();
    assert(weights.length == 2);
    assert(weights[0].receiver == addr3);
    assert(weights[0].weightReceiver == 4);
    assert(weights[0].weightProxy == 0);
    assert(weights[1].receiver == addr1);
    assert(weights[1].weightReceiver == 1);
    assert(weights[1].weightProxy == 0);
  });

  it("Allows removing two middle items", async function () {
    const weightsTest = await deployReceiverWeightsTest();
    const [addr1, addr2, addr3, addr4] = randomAddresses();

    await weightsTest.setWeights([
      { receiver: addr1, weightReceiver: 1, weightProxy: 0 },
      { receiver: addr2, weightReceiver: 2, weightProxy: 0 },
      { receiver: addr3, weightReceiver: 4, weightProxy: 0 },
      { receiver: addr4, weightReceiver: 8, weightProxy: 0 },
      { receiver: addr2, weightReceiver: 0, weightProxy: 0 },
      { receiver: addr3, weightReceiver: 0, weightProxy: 0 },
    ]);

    assert(
      (await weightsTest.weightReceiverSumDelta()).eq(1 + 2 + 4 + 8 - 2 - 4)
    );
    assert((await weightsTest.weightProxySumDelta()).eq(0));
    const weights = await weightsTest.getReceiverWeightsIterated();
    assert(weights.length == 2);
    assert(weights[0].receiver == addr4);
    assert(weights[0].weightReceiver == 8);
    assert(weights[0].weightProxy == 0);
    assert(weights[1].receiver == addr1);
    assert(weights[1].weightReceiver == 1);
    assert(weights[1].weightProxy == 0);
  });

  it("Allows removing all items", async function () {
    const weightsTest = await deployReceiverWeightsTest();
    const [addr1, addr2, addr3] = randomAddresses();

    await weightsTest.setWeights([
      { receiver: addr1, weightReceiver: 1, weightProxy: 0 },
      { receiver: addr2, weightReceiver: 2, weightProxy: 0 },
      { receiver: addr3, weightReceiver: 4, weightProxy: 0 },
      { receiver: addr1, weightReceiver: 0, weightProxy: 0 },
      { receiver: addr2, weightReceiver: 0, weightProxy: 0 },
      { receiver: addr3, weightReceiver: 0, weightProxy: 0 },
    ]);

    assert(
      (await weightsTest.weightReceiverSumDelta()).eq(1 + 2 + 4 - 1 - 2 - 4)
    );
    assert((await weightsTest.weightProxySumDelta()).eq(0));
    const weights = await weightsTest.getReceiverWeightsIterated();
    assert(weights.length == 0);
  });

  it("Allows adding items after removing all items", async function () {
    // Add an item and then clear the list
    const weightsTest = await deployReceiverWeightsTest();
    const [addr1] = randomAddresses();

    await weightsTest.setWeights([
      { receiver: addr1, weightReceiver: 1, weightProxy: 0 },
      { receiver: addr1, weightReceiver: 0, weightProxy: 0 },
    ]);

    assert((await weightsTest.weightReceiverSumDelta()).eq(1 - 1));
    assert((await weightsTest.weightProxySumDelta()).eq(0));
    let weights = await weightsTest.getReceiverWeightsIterated();
    assert(weights.length == 0);

    // Add an item
    await weightsTest.setWeights([
      { receiver: addr1, weightReceiver: 2, weightProxy: 0 },
    ]);

    assert((await weightsTest.weightReceiverSumDelta()).eq(2));
    assert((await weightsTest.weightProxySumDelta()).eq(0));
    weights = await weightsTest.getReceiverWeightsIterated();
    assert(weights.length == 1);
    assert(weights[0].receiver == addr1);
    assert(weights[0].weightReceiver == 2);
    assert(weights[0].weightProxy == 0);
  });

  it("Allows updating the first item", async function () {
    const weightsTest = await deployReceiverWeightsTest();
    const [addr1, addr2, addr3] = randomAddresses();

    await weightsTest.setWeights([
      { receiver: addr1, weightReceiver: 1, weightProxy: 0 },
      { receiver: addr2, weightReceiver: 2, weightProxy: 0 },
      { receiver: addr3, weightReceiver: 4, weightProxy: 0 },
      { receiver: addr3, weightReceiver: 8, weightProxy: 0 },
    ]);

    assert((await weightsTest.weightReceiverSumDelta()).eq(1 + 2 + 4 - 4 + 8));
    assert((await weightsTest.weightProxySumDelta()).eq(0));
    const weights = await weightsTest.getReceiverWeightsIterated();
    assert(weights.length == 3);
    assert(weights[0].receiver == addr3);
    assert(weights[0].weightReceiver == 8);
    assert(weights[0].weightProxy == 0);
    assert(weights[1].receiver == addr2);
    assert(weights[1].weightReceiver == 2);
    assert(weights[1].weightProxy == 0);
    assert(weights[2].receiver == addr1);
    assert(weights[2].weightReceiver == 1);
    assert(weights[2].weightProxy == 0);
  });

  it("Allows updating the middle item", async function () {
    const weightsTest = await deployReceiverWeightsTest();
    const [addr1, addr2, addr3] = randomAddresses();

    await weightsTest.setWeights([
      { receiver: addr1, weightReceiver: 1, weightProxy: 0 },
      { receiver: addr2, weightReceiver: 2, weightProxy: 0 },
      { receiver: addr3, weightReceiver: 4, weightProxy: 0 },
      { receiver: addr2, weightReceiver: 8, weightProxy: 0 },
    ]);

    assert((await weightsTest.weightReceiverSumDelta()).eq(1 + 2 + 4 - 2 + 8));
    assert((await weightsTest.weightProxySumDelta()).eq(0));
    const weights = await weightsTest.getReceiverWeightsIterated();
    assert(weights.length == 3);
    assert(weights[0].receiver == addr3);
    assert(weights[0].weightReceiver == 4);
    assert(weights[0].weightProxy == 0);
    assert(weights[1].receiver == addr2);
    assert(weights[1].weightReceiver == 8);
    assert(weights[1].weightProxy == 0);
    assert(weights[2].receiver == addr1);
    assert(weights[2].weightReceiver == 1);
    assert(weights[2].weightProxy == 0);
  });

  it("Allows updating the last item", async function () {
    const weightsTest = await deployReceiverWeightsTest();
    const [addr1, addr2, addr3] = randomAddresses();

    await weightsTest.setWeights([
      { receiver: addr1, weightReceiver: 1, weightProxy: 0 },
      { receiver: addr2, weightReceiver: 2, weightProxy: 0 },
      { receiver: addr3, weightReceiver: 4, weightProxy: 0 },
      { receiver: addr1, weightReceiver: 8, weightProxy: 0 },
    ]);

    assert((await weightsTest.weightReceiverSumDelta()).eq(1 + 2 + 4 - 1 + 8));
    assert((await weightsTest.weightProxySumDelta()).eq(0));
    const weights = await weightsTest.getReceiverWeightsIterated();
    assert(weights.length == 3);
    assert(weights[0].receiver == addr3);
    assert(weights[0].weightReceiver == 4);
    assert(weights[0].weightProxy == 0);
    assert(weights[1].receiver == addr2);
    assert(weights[1].weightReceiver == 2);
    assert(weights[1].weightProxy == 0);
    assert(weights[2].receiver == addr1);
    assert(weights[2].weightReceiver == 8);
    assert(weights[2].weightProxy == 0);
  });

  it("Rejects setting weight for address 0", async function () {
    const weightsTest = await deployReceiverWeightsTest();
    await expectSetWeightsWithInvalidAddressReverts(weightsTest, [
      { receiver: numberToAddress(0), weightReceiver: 1, weightProxy: 0 },
    ]);
  });

  it("Keeps items with only proxy weights set", async function () {
    const weightsTest = await deployReceiverWeightsTest();
    const [addr1] = randomAddresses();

    await weightsTest.setWeights([
      { receiver: addr1, weightReceiver: 0, weightProxy: 1 },
    ]);

    assert((await weightsTest.weightReceiverSumDelta()).eq(0));
    assert((await weightsTest.weightProxySumDelta()).eq(1));
    const weights = await weightsTest.getReceiverWeightsIterated();
    assert(weights.length == 1);
    assert(weights[0].receiver == addr1);
    assert(weights[0].weightReceiver == 0);
    assert(weights[0].weightProxy == 1);
  });

  it("Allows removing items with only proxy weights set", async function () {
    const weightsTest = await deployReceiverWeightsTest();
    const [addr1, addr2] = randomAddresses();

    await weightsTest.setWeights([
      { receiver: addr1, weightReceiver: 0, weightProxy: 1 },
      { receiver: addr2, weightReceiver: 0, weightProxy: 2 },
      { receiver: addr1, weightReceiver: 0, weightProxy: 0 },
    ]);

    assert((await weightsTest.weightReceiverSumDelta()).eq(0));
    assert((await weightsTest.weightProxySumDelta()).eq(1 + 2 - 1));
    const weights = await weightsTest.getReceiverWeightsIterated();
    assert(weights.length == 1);
    assert(weights[0].receiver == addr2);
    assert(weights[0].weightReceiver == 0);
    assert(weights[0].weightProxy == 2);
  });
});
