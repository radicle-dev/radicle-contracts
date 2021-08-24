import { ReceiverWeightsTest, ReceiverWeightsTest__factory } from "../contract-bindings/ethers";
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
    weight: BigNumberish;
  }[]
): Promise<void> {
  await submitFailing(weightsTest.setWeights(weights), "setWeights", "Invalid receiver address");
}

describe("ReceiverWeights", function () {
  it("Is empty on the beginning", async function () {
    const weightsTest = await deployReceiverWeightsTest();

    await weightsTest.setWeights([]);

    assert((await weightsTest.weightSumDelta()).eq(0));
    const weights = await weightsTest.getReceiverWeightsIterated();
    assert(weights.length == 0);
  });

  it("Keeps a single added item", async function () {
    const weightsTest = await deployReceiverWeightsTest();
    const [addr1] = randomAddresses();

    await weightsTest.setWeights([{ receiver: addr1, weight: 1 }]);

    assert((await weightsTest.weightSumDelta()).eq(1));
    const weights = await weightsTest.getReceiverWeightsIterated();
    assert(weights.length == 1);
    assert(weights[0].receiver == addr1);
    assert(weights[0].weight == 1);
  });

  it("Keeps multiple added items", async function () {
    const weightsTest = await deployReceiverWeightsTest();
    const [addr1, addr2, addr3] = randomAddresses();

    await weightsTest.setWeights([
      { receiver: addr1, weight: 1 },
      { receiver: addr2, weight: 2 },
      { receiver: addr3, weight: 4 },
    ]);

    assert((await weightsTest.weightSumDelta()).eq(1 + 2 + 4));
    const weights = await weightsTest.getReceiverWeightsIterated();
    assert(weights.length == 3);
    assert(weights[0].receiver == addr3);
    assert(weights[0].weight == 4);
    assert(weights[1].receiver == addr2);
    assert(weights[1].weight == 2);
    assert(weights[2].receiver == addr1);
    assert(weights[2].weight == 1);
  });

  it("Allows removing the last item", async function () {
    const weightsTest = await deployReceiverWeightsTest();
    const [addr1, addr2, addr3] = randomAddresses();

    await weightsTest.setWeights([
      { receiver: addr1, weight: 1 },
      { receiver: addr2, weight: 2 },
      { receiver: addr3, weight: 4 },
      { receiver: addr1, weight: 0 },
    ]);

    assert((await weightsTest.weightSumDelta()).eq(1 + 2 + 4 - 1));
    const weights = await weightsTest.getReceiverWeightsIterated();
    assert(weights.length == 2);
    assert(weights[0].receiver == addr3);
    assert(weights[0].weight == 4);
    assert(weights[1].receiver == addr2);
    assert(weights[1].weight == 2);
  });

  it("Allows removing two last items", async function () {
    const weightsTest = await deployReceiverWeightsTest();
    const [addr1, addr2, addr3] = randomAddresses();

    await weightsTest.setWeights([
      { receiver: addr1, weight: 1 },
      { receiver: addr2, weight: 2 },
      { receiver: addr3, weight: 4 },
      { receiver: addr1, weight: 0 },
      { receiver: addr2, weight: 0 },
    ]);

    assert((await weightsTest.weightSumDelta()).eq(1 + 2 + 4 - 1 - 2));
    const weights = await weightsTest.getReceiverWeightsIterated();
    assert(weights.length == 1);
    assert(weights[0].receiver == addr3);
    assert(weights[0].weight == 4);
  });

  it("Allows removing the first item", async function () {
    const weightsTest = await deployReceiverWeightsTest();
    const [addr1, addr2, addr3] = randomAddresses();

    await weightsTest.setWeights([
      { receiver: addr1, weight: 1 },
      { receiver: addr2, weight: 2 },
      { receiver: addr3, weight: 4 },
      { receiver: addr3, weight: 0 },
    ]);

    assert((await weightsTest.weightSumDelta()).eq(1 + 2 + 4 - 4));
    const weights = await weightsTest.getReceiverWeightsIterated();
    assert(weights.length == 2);
    assert(weights[0].receiver == addr2);
    assert(weights[0].weight == 2);
    assert(weights[1].receiver == addr1);
    assert(weights[1].weight == 1);
  });

  it("Allows removing two first items", async function () {
    const weightsTest = await deployReceiverWeightsTest();
    const [addr1, addr2, addr3] = randomAddresses();

    await weightsTest.setWeights([
      { receiver: addr1, weight: 1 },
      { receiver: addr2, weight: 2 },
      { receiver: addr3, weight: 4 },
      { receiver: addr2, weight: 0 },
      { receiver: addr3, weight: 0 },
    ]);

    assert((await weightsTest.weightSumDelta()).eq(1 + 2 + 4 - 2 - 4));
    const weights = await weightsTest.getReceiverWeightsIterated();
    assert(weights.length == 1);
    assert(weights[0].receiver == addr1);
    assert(weights[0].weight == 1);
  });

  it("Allows removing the middle item", async function () {
    const weightsTest = await deployReceiverWeightsTest();
    const [addr1, addr2, addr3] = randomAddresses();

    await weightsTest.setWeights([
      { receiver: addr1, weight: 1 },
      { receiver: addr2, weight: 2 },
      { receiver: addr3, weight: 4 },
      { receiver: addr2, weight: 0 },
    ]);

    assert((await weightsTest.weightSumDelta()).eq(1 + 2 + 4 - 2));
    const weights = await weightsTest.getReceiverWeightsIterated();
    assert(weights.length == 2);
    assert(weights[0].receiver == addr3);
    assert(weights[0].weight == 4);
    assert(weights[1].receiver == addr1);
    assert(weights[1].weight == 1);
  });

  it("Allows removing two middle items", async function () {
    const weightsTest = await deployReceiverWeightsTest();
    const [addr1, addr2, addr3, addr4] = randomAddresses();

    await weightsTest.setWeights([
      { receiver: addr1, weight: 1 },
      { receiver: addr2, weight: 2 },
      { receiver: addr3, weight: 4 },
      { receiver: addr4, weight: 8 },
      { receiver: addr2, weight: 0 },
      { receiver: addr3, weight: 0 },
    ]);

    assert((await weightsTest.weightSumDelta()).eq(1 + 2 + 4 + 8 - 2 - 4));
    const weights = await weightsTest.getReceiverWeightsIterated();
    assert(weights.length == 2);
    assert(weights[0].receiver == addr4);
    assert(weights[0].weight == 8);
    assert(weights[1].receiver == addr1);
    assert(weights[1].weight == 1);
  });

  it("Allows removing all items", async function () {
    const weightsTest = await deployReceiverWeightsTest();
    const [addr1, addr2, addr3] = randomAddresses();

    await weightsTest.setWeights([
      { receiver: addr1, weight: 1 },
      { receiver: addr2, weight: 2 },
      { receiver: addr3, weight: 4 },
      { receiver: addr1, weight: 0 },
      { receiver: addr2, weight: 0 },
      { receiver: addr3, weight: 0 },
    ]);

    assert((await weightsTest.weightSumDelta()).eq(1 + 2 + 4 - 1 - 2 - 4));
    const weights = await weightsTest.getReceiverWeightsIterated();
    assert(weights.length == 0);
  });

  it("Allows adding items after removing all items", async function () {
    // Add an item and then clear the list
    const weightsTest = await deployReceiverWeightsTest();
    const [addr1] = randomAddresses();

    await weightsTest.setWeights([
      { receiver: addr1, weight: 1 },
      { receiver: addr1, weight: 0 },
    ]);

    assert((await weightsTest.weightSumDelta()).eq(1 - 1));
    let weights = await weightsTest.getReceiverWeightsIterated();
    assert(weights.length == 0);

    // Add an item
    await weightsTest.setWeights([{ receiver: addr1, weight: 2 }]);

    assert((await weightsTest.weightSumDelta()).eq(2));
    weights = await weightsTest.getReceiverWeightsIterated();
    assert(weights.length == 1);
    assert(weights[0].receiver == addr1);
    assert(weights[0].weight == 2);
  });

  it("Allows updating the first item", async function () {
    const weightsTest = await deployReceiverWeightsTest();
    const [addr1, addr2, addr3] = randomAddresses();

    await weightsTest.setWeights([
      { receiver: addr1, weight: 1 },
      { receiver: addr2, weight: 2 },
      { receiver: addr3, weight: 4 },
      { receiver: addr3, weight: 8 },
    ]);

    assert((await weightsTest.weightSumDelta()).eq(1 + 2 + 4 - 4 + 8));
    const weights = await weightsTest.getReceiverWeightsIterated();
    assert(weights.length == 3);
    assert(weights[0].receiver == addr3);
    assert(weights[0].weight == 8);
    assert(weights[1].receiver == addr2);
    assert(weights[1].weight == 2);
    assert(weights[2].receiver == addr1);
    assert(weights[2].weight == 1);
  });

  it("Allows updating the middle item", async function () {
    const weightsTest = await deployReceiverWeightsTest();
    const [addr1, addr2, addr3] = randomAddresses();

    await weightsTest.setWeights([
      { receiver: addr1, weight: 1 },
      { receiver: addr2, weight: 2 },
      { receiver: addr3, weight: 4 },
      { receiver: addr2, weight: 8 },
    ]);

    assert((await weightsTest.weightSumDelta()).eq(1 + 2 + 4 - 2 + 8));
    const weights = await weightsTest.getReceiverWeightsIterated();
    assert(weights.length == 3);
    assert(weights[0].receiver == addr3);
    assert(weights[0].weight == 4);
    assert(weights[1].receiver == addr2);
    assert(weights[1].weight == 8);
    assert(weights[2].receiver == addr1);
    assert(weights[2].weight == 1);
  });

  it("Allows updating the last item", async function () {
    const weightsTest = await deployReceiverWeightsTest();
    const [addr1, addr2, addr3] = randomAddresses();

    await weightsTest.setWeights([
      { receiver: addr1, weight: 1 },
      { receiver: addr2, weight: 2 },
      { receiver: addr3, weight: 4 },
      { receiver: addr1, weight: 8 },
    ]);

    assert((await weightsTest.weightSumDelta()).eq(1 + 2 + 4 - 1 + 8));
    const weights = await weightsTest.getReceiverWeightsIterated();
    assert(weights.length == 3);
    assert(weights[0].receiver == addr3);
    assert(weights[0].weight == 4);
    assert(weights[1].receiver == addr2);
    assert(weights[1].weight == 2);
    assert(weights[2].receiver == addr1);
    assert(weights[2].weight == 8);
  });

  it("Rejects setting weight for address 0", async function () {
    const weightsTest = await deployReceiverWeightsTest();
    await expectSetWeightsWithInvalidAddressReverts(weightsTest, [
      { receiver: numberToAddress(0), weight: 1 },
    ]);
  });
});
