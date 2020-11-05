import {ReceiverWeightsTestFactory} from "../contract-bindings/ethers";
import {ReceiverWeightsTest} from "../contract-bindings/ethers/ReceiverWeightsTest";
import buidler from "@nomiclabs/buidler";
import {BigNumberish} from "ethers";
import {assert} from "chai";
import {numberToAddress, randomAddresses, submitFailing} from "./support";

async function deployReceiverWeightsTest(): Promise<ReceiverWeightsTest> {
  const [signer] = await buidler.ethers.getSigners();
  return new ReceiverWeightsTestFactory(signer)
    .deploy()
    .then((weights) => weights.deployed());
}

async function expectSetWeightsWithInvalidAddressReverts(
  weights_test: ReceiverWeightsTest,
  weights: {
    receiver: string;
    weightReceiver: BigNumberish;
    weightProxy: BigNumberish;
  }[]
): Promise<void> {
  await submitFailing(
    weights_test.setWeights(weights),
    "setWeights",
    "Invalid receiver address"
  );
}

describe("ReceiverWeights", function () {
  it("Is empty on the beginning", async function () {
    const weights_test = await deployReceiverWeightsTest();

    await weights_test.setWeights([]);

    assert((await weights_test.weightReceiverSumDelta()).eq(0));
    assert((await weights_test.weightProxySumDelta()).eq(0));
    const weights = await weights_test.getReceiverWeightsIterated();
    assert(weights.length == 0);
  });

  it("Keeps a single added item", async function () {
    const weights_test = await deployReceiverWeightsTest();
    const [addr1] = randomAddresses();

    await weights_test.setWeights([
      {receiver: addr1, weightReceiver: 1, weightProxy: 0},
    ]);

    assert((await weights_test.weightReceiverSumDelta()).eq(1));
    assert((await weights_test.weightProxySumDelta()).eq(0));
    const weights = await weights_test.getReceiverWeightsIterated();
    assert(weights.length == 1);
    assert(weights[0].receiver == addr1);
    assert(weights[0].weightReceiver == 1);
    assert(weights[0].weightProxy == 0);
  });

  it("Keeps multiple added items", async function () {
    const weights_test = await deployReceiverWeightsTest();
    const [addr1, addr2, addr3] = randomAddresses();

    await weights_test.setWeights([
      {receiver: addr1, weightReceiver: 1, weightProxy: 0},
      {receiver: addr2, weightReceiver: 2, weightProxy: 0},
      {receiver: addr3, weightReceiver: 4, weightProxy: 0},
    ]);

    assert((await weights_test.weightReceiverSumDelta()).eq(1 + 2 + 4));
    assert((await weights_test.weightProxySumDelta()).eq(0));
    const weights = await weights_test.getReceiverWeightsIterated();
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
    const weights_test = await deployReceiverWeightsTest();
    const [addr1, addr2, addr3] = randomAddresses();

    await weights_test.setWeights([
      {receiver: addr1, weightReceiver: 1, weightProxy: 0},
      {receiver: addr2, weightReceiver: 2, weightProxy: 0},
      {receiver: addr3, weightReceiver: 4, weightProxy: 0},
      {receiver: addr1, weightReceiver: 0, weightProxy: 0},
    ]);

    assert((await weights_test.weightReceiverSumDelta()).eq(1 + 2 + 4 - 1));
    assert((await weights_test.weightProxySumDelta()).eq(0));
    const weights = await weights_test.getReceiverWeightsIterated();
    assert(weights.length == 2);
    assert(weights[0].receiver == addr3);
    assert(weights[0].weightReceiver == 4);
    assert(weights[0].weightProxy == 0);
    assert(weights[1].receiver == addr2);
    assert(weights[1].weightReceiver == 2);
    assert(weights[1].weightProxy == 0);
  });

  it("Allows removing two last items", async function () {
    const weights_test = await deployReceiverWeightsTest();
    const [addr1, addr2, addr3] = randomAddresses();

    await weights_test.setWeights([
      {receiver: addr1, weightReceiver: 1, weightProxy: 0},
      {receiver: addr2, weightReceiver: 2, weightProxy: 0},
      {receiver: addr3, weightReceiver: 4, weightProxy: 0},
      {receiver: addr1, weightReceiver: 0, weightProxy: 0},
      {receiver: addr2, weightReceiver: 0, weightProxy: 0},
    ]);

    assert((await weights_test.weightReceiverSumDelta()).eq(1 + 2 + 4 - 1 - 2));
    assert((await weights_test.weightProxySumDelta()).eq(0));
    const weights = await weights_test.getReceiverWeightsIterated();
    assert(weights.length == 1);
    assert(weights[0].receiver == addr3);
    assert(weights[0].weightReceiver == 4);
    assert(weights[0].weightProxy == 0);
  });

  it("Allows removing the first item", async function () {
    const weights_test = await deployReceiverWeightsTest();
    const [addr1, addr2, addr3] = randomAddresses();

    await weights_test.setWeights([
      {receiver: addr1, weightReceiver: 1, weightProxy: 0},
      {receiver: addr2, weightReceiver: 2, weightProxy: 0},
      {receiver: addr3, weightReceiver: 4, weightProxy: 0},
      {receiver: addr3, weightReceiver: 0, weightProxy: 0},
    ]);

    assert((await weights_test.weightReceiverSumDelta()).eq(1 + 2 + 4 - 4));
    assert((await weights_test.weightProxySumDelta()).eq(0));
    const weights = await weights_test.getReceiverWeightsIterated();
    assert(weights.length == 2);
    assert(weights[0].receiver == addr2);
    assert(weights[0].weightReceiver == 2);
    assert(weights[0].weightProxy == 0);
    assert(weights[1].receiver == addr1);
    assert(weights[1].weightReceiver == 1);
    assert(weights[1].weightProxy == 0);
  });

  it("Allows removing two first items", async function () {
    const weights_test = await deployReceiverWeightsTest();
    const [addr1, addr2, addr3] = randomAddresses();

    await weights_test.setWeights([
      {receiver: addr1, weightReceiver: 1, weightProxy: 0},
      {receiver: addr2, weightReceiver: 2, weightProxy: 0},
      {receiver: addr3, weightReceiver: 4, weightProxy: 0},
      {receiver: addr2, weightReceiver: 0, weightProxy: 0},
      {receiver: addr3, weightReceiver: 0, weightProxy: 0},
    ]);

    assert((await weights_test.weightReceiverSumDelta()).eq(1 + 2 + 4 - 2 - 4));
    assert((await weights_test.weightProxySumDelta()).eq(0));
    const weights = await weights_test.getReceiverWeightsIterated();
    assert(weights.length == 1);
    assert(weights[0].receiver == addr1);
    assert(weights[0].weightReceiver == 1);
    assert(weights[0].weightProxy == 0);
  });

  it("Allows removing the middle item", async function () {
    const weights_test = await deployReceiverWeightsTest();
    const [addr1, addr2, addr3] = randomAddresses();

    await weights_test.setWeights([
      {receiver: addr1, weightReceiver: 1, weightProxy: 0},
      {receiver: addr2, weightReceiver: 2, weightProxy: 0},
      {receiver: addr3, weightReceiver: 4, weightProxy: 0},
      {receiver: addr2, weightReceiver: 0, weightProxy: 0},
    ]);

    assert((await weights_test.weightReceiverSumDelta()).eq(1 + 2 + 4 - 2));
    assert((await weights_test.weightProxySumDelta()).eq(0));
    const weights = await weights_test.getReceiverWeightsIterated();
    assert(weights.length == 2);
    assert(weights[0].receiver == addr3);
    assert(weights[0].weightReceiver == 4);
    assert(weights[0].weightProxy == 0);
    assert(weights[1].receiver == addr1);
    assert(weights[1].weightReceiver == 1);
    assert(weights[1].weightProxy == 0);
  });

  it("Allows removing two middle items", async function () {
    const weights_test = await deployReceiverWeightsTest();
    const [addr1, addr2, addr3, addr4] = randomAddresses();

    await weights_test.setWeights([
      {receiver: addr1, weightReceiver: 1, weightProxy: 0},
      {receiver: addr2, weightReceiver: 2, weightProxy: 0},
      {receiver: addr3, weightReceiver: 4, weightProxy: 0},
      {receiver: addr4, weightReceiver: 8, weightProxy: 0},
      {receiver: addr2, weightReceiver: 0, weightProxy: 0},
      {receiver: addr3, weightReceiver: 0, weightProxy: 0},
    ]);

    assert(
      (await weights_test.weightReceiverSumDelta()).eq(1 + 2 + 4 + 8 - 2 - 4)
    );
    assert((await weights_test.weightProxySumDelta()).eq(0));
    const weights = await weights_test.getReceiverWeightsIterated();
    assert(weights.length == 2);
    assert(weights[0].receiver == addr4);
    assert(weights[0].weightReceiver == 8);
    assert(weights[0].weightProxy == 0);
    assert(weights[1].receiver == addr1);
    assert(weights[1].weightReceiver == 1);
    assert(weights[1].weightProxy == 0);
  });

  it("Allows removing all items", async function () {
    const weights_test = await deployReceiverWeightsTest();
    const [addr1, addr2, addr3] = randomAddresses();

    await weights_test.setWeights([
      {receiver: addr1, weightReceiver: 1, weightProxy: 0},
      {receiver: addr2, weightReceiver: 2, weightProxy: 0},
      {receiver: addr3, weightReceiver: 4, weightProxy: 0},
      {receiver: addr1, weightReceiver: 0, weightProxy: 0},
      {receiver: addr2, weightReceiver: 0, weightProxy: 0},
      {receiver: addr3, weightReceiver: 0, weightProxy: 0},
    ]);

    assert(
      (await weights_test.weightReceiverSumDelta()).eq(1 + 2 + 4 - 1 - 2 - 4)
    );
    assert((await weights_test.weightProxySumDelta()).eq(0));
    const weights = await weights_test.getReceiverWeightsIterated();
    assert(weights.length == 0);
  });

  it("Allows adding items after removing all items", async function () {
    // Add an item and then clear the list
    const weights_test = await deployReceiverWeightsTest();
    const [addr1] = randomAddresses();

    await weights_test.setWeights([
      {receiver: addr1, weightReceiver: 1, weightProxy: 0},
      {receiver: addr1, weightReceiver: 0, weightProxy: 0},
    ]);

    assert((await weights_test.weightReceiverSumDelta()).eq(1 - 1));
    assert((await weights_test.weightProxySumDelta()).eq(0));
    let weights = await weights_test.getReceiverWeightsIterated();
    assert(weights.length == 0);

    // Add an item
    await weights_test.setWeights([
      {receiver: addr1, weightReceiver: 2, weightProxy: 0},
    ]);

    assert((await weights_test.weightReceiverSumDelta()).eq(2));
    assert((await weights_test.weightProxySumDelta()).eq(0));
    weights = await weights_test.getReceiverWeightsIterated();
    assert(weights.length == 1);
    assert(weights[0].receiver == addr1);
    assert(weights[0].weightReceiver == 2);
    assert(weights[0].weightProxy == 0);
  });

  it("Allows updating the first item", async function () {
    const weights_test = await deployReceiverWeightsTest();
    const [addr1, addr2, addr3] = randomAddresses();

    await weights_test.setWeights([
      {receiver: addr1, weightReceiver: 1, weightProxy: 0},
      {receiver: addr2, weightReceiver: 2, weightProxy: 0},
      {receiver: addr3, weightReceiver: 4, weightProxy: 0},
      {receiver: addr3, weightReceiver: 8, weightProxy: 0},
    ]);

    assert((await weights_test.weightReceiverSumDelta()).eq(1 + 2 + 4 - 4 + 8));
    assert((await weights_test.weightProxySumDelta()).eq(0));
    const weights = await weights_test.getReceiverWeightsIterated();
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
    const weights_test = await deployReceiverWeightsTest();
    const [addr1, addr2, addr3] = randomAddresses();

    await weights_test.setWeights([
      {receiver: addr1, weightReceiver: 1, weightProxy: 0},
      {receiver: addr2, weightReceiver: 2, weightProxy: 0},
      {receiver: addr3, weightReceiver: 4, weightProxy: 0},
      {receiver: addr2, weightReceiver: 8, weightProxy: 0},
    ]);

    assert((await weights_test.weightReceiverSumDelta()).eq(1 + 2 + 4 - 2 + 8));
    assert((await weights_test.weightProxySumDelta()).eq(0));
    const weights = await weights_test.getReceiverWeightsIterated();
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
    const weights_test = await deployReceiverWeightsTest();
    const [addr1, addr2, addr3] = randomAddresses();

    await weights_test.setWeights([
      {receiver: addr1, weightReceiver: 1, weightProxy: 0},
      {receiver: addr2, weightReceiver: 2, weightProxy: 0},
      {receiver: addr3, weightReceiver: 4, weightProxy: 0},
      {receiver: addr1, weightReceiver: 8, weightProxy: 0},
    ]);

    assert((await weights_test.weightReceiverSumDelta()).eq(1 + 2 + 4 - 1 + 8));
    assert((await weights_test.weightProxySumDelta()).eq(0));
    const weights = await weights_test.getReceiverWeightsIterated();
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
    const weights_test = await deployReceiverWeightsTest();
    await expectSetWeightsWithInvalidAddressReverts(weights_test, [
      {receiver: numberToAddress(0), weightReceiver: 1, weightProxy: 0},
    ]);
  });

  it("Rejects setting weight for address 1", async function () {
    const weights_test = await deployReceiverWeightsTest();
    await expectSetWeightsWithInvalidAddressReverts(weights_test, [
      {receiver: numberToAddress(1), weightReceiver: 1, weightProxy: 0},
    ]);
  });

  it("Keeps items with only proxy weights set", async function () {
    const weights_test = await deployReceiverWeightsTest();
    const [addr1] = randomAddresses();

    await weights_test.setWeights([
      {receiver: addr1, weightReceiver: 0, weightProxy: 1},
    ]);

    assert((await weights_test.weightReceiverSumDelta()).eq(0));
    assert((await weights_test.weightProxySumDelta()).eq(1));
    const weights = await weights_test.getReceiverWeightsIterated();
    assert(weights.length == 1);
    assert(weights[0].receiver == addr1);
    assert(weights[0].weightReceiver == 0);
    assert(weights[0].weightProxy == 1);
  });

  it("Allows removing items with only proxy weights set", async function () {
    const weights_test = await deployReceiverWeightsTest();
    const [addr1, addr2] = randomAddresses();

    await weights_test.setWeights([
      {receiver: addr1, weightReceiver: 0, weightProxy: 1},
      {receiver: addr2, weightReceiver: 0, weightProxy: 2},
      {receiver: addr1, weightReceiver: 0, weightProxy: 0},
    ]);

    assert((await weights_test.weightReceiverSumDelta()).eq(0));
    assert((await weights_test.weightProxySumDelta()).eq(1 + 2 - 1));
    const weights = await weights_test.getReceiverWeightsIterated();
    assert(weights.length == 1);
    assert(weights[0].receiver == addr2);
    assert(weights[0].weightReceiver == 0);
    assert(weights[0].weightProxy == 2);
  });
});
