import {
  PoolFactory,
  ReceiverWeightsTestFactory,
} from "../contract-bindings/ethers";
import {Pool} from "../contract-bindings/ethers/Pool";
import {ReceiverWeightsTest} from "../contract-bindings/ethers/ReceiverWeightsTest";
import buidler from "@nomiclabs/buidler";

import {assert} from "chai";

async function deployPool(): Promise<Pool> {
  const [signer] = await buidler.ethers.getSigners();
  return new PoolFactory(signer).deploy().then((pool) => pool.deployed());
}

describe("Pool", function () {
  it("rejects withdrawal from an empty account", async function () {
    const pool = await deployPool();
    await pool
      .withdraw(1)
      .then(() => assert.fail())
      .catch((error: Error) =>
        assert(error.message.endsWith("Not enough funds in account"))
      );
  });

  it("allows withdrawal from an account up to its value", async function () {
    const pool = await deployPool();
    await pool.topUp({value: 100});
    await pool.withdraw(99);
    await pool.withdraw(1);
  });

  it("rejects withdrawal from an account over its value", async function () {
    const pool = await deployPool();
    await pool.topUp({value: 100});
    await pool
      .withdraw(101)
      .then(() => assert.fail())
      .catch((error: Error) =>
        assert(error.message.endsWith("Not enough funds in account"))
      );
  });
});

async function deployReceiverWeightsTest(): Promise<ReceiverWeightsTest> {
  const [signer] = await buidler.ethers.getSigners();
  return new ReceiverWeightsTestFactory(signer)
    .deploy()
    .then((weights) => weights.deployed());
}

async function addr(idx: number): Promise<string> {
  const signers = await buidler.ethers.getSigners();
  return await signers[idx].getAddress();
}

describe("ReceiverWeights", function () {
  it("Is empty on the beginning", async function () {
    const weights_test = await deployReceiverWeightsTest();

    const tx = await weights_test.setWeights([]);

    console.log("Gas used: ", (await tx.wait()).gasUsed.toString());
    assert((await weights_test.receiverWeightsSumDelta()).eq(0));
    const weights = await weights_test.getReceiverWeightsIterated();
    assert(weights.length == 0);
  });

  it("Keeps a single added item", async function () {
    const weights_test = await deployReceiverWeightsTest();
    const addr1 = await addr(1);

    const tx = await weights_test.setWeights([{receiver: addr1, weight: 1}]);

    console.log("Gas used: ", (await tx.wait()).gasUsed.toString());
    assert((await weights_test.receiverWeightsSumDelta()).eq(1));
    const weights = await weights_test.getReceiverWeightsIterated();
    assert(weights.length == 1);
    assert(weights[0].receiver == addr1);
    assert(weights[0].weight == 1);
  });

  it("Keeps multiple added items", async function () {
    const weights_test = await deployReceiverWeightsTest();
    const addr1 = await addr(1);
    const addr2 = await addr(2);
    const addr3 = await addr(3);

    const tx = await weights_test.setWeights([
      {receiver: addr1, weight: 1},
      {receiver: addr2, weight: 2},
      {receiver: addr3, weight: 4},
    ]);

    console.log("Gas used: ", (await tx.wait()).gasUsed.toString());
    assert((await weights_test.receiverWeightsSumDelta()).eq(1 + 2 + 4));
    const weights = await weights_test.getReceiverWeightsIterated();
    assert(weights.length == 3);
    assert(weights[0].receiver == addr3);
    assert(weights[0].weight == 4);
    assert(weights[1].receiver == addr2);
    assert(weights[1].weight == 2);
    assert(weights[2].receiver == addr1);
    assert(weights[2].weight == 1);
  });

  it("Allows removing the last item", async function () {
    const weights_test = await deployReceiverWeightsTest();
    const addr1 = await addr(1);
    const addr2 = await addr(2);
    const addr3 = await addr(3);

    const tx = await weights_test.setWeights([
      {receiver: addr1, weight: 1},
      {receiver: addr2, weight: 2},
      {receiver: addr3, weight: 4},
      {receiver: addr1, weight: 0},
    ]);

    console.log("Gas used: ", (await tx.wait()).gasUsed.toString());
    assert((await weights_test.receiverWeightsSumDelta()).eq(1 + 2 + 4 - 1));
    const weights = await weights_test.getReceiverWeightsIterated();
    assert(weights.length == 2);
    assert(weights[0].receiver == addr3);
    assert(weights[0].weight == 4);
    assert(weights[1].receiver == addr2);
    assert(weights[1].weight == 2);
  });

  it("Allows removing two last items", async function () {
    const weights_test = await deployReceiverWeightsTest();
    const addr1 = await addr(1);
    const addr2 = await addr(2);
    const addr3 = await addr(3);

    const tx = await weights_test.setWeights([
      {receiver: addr1, weight: 1},
      {receiver: addr2, weight: 2},
      {receiver: addr3, weight: 4},
      {receiver: addr1, weight: 0},
      {receiver: addr2, weight: 0},
    ]);

    console.log("Gas used: ", (await tx.wait()).gasUsed.toString());
    assert(
      (await weights_test.receiverWeightsSumDelta()).eq(1 + 2 + 4 - 1 - 2)
    );
    const weights = await weights_test.getReceiverWeightsIterated();
    assert(weights.length == 1);
    assert(weights[0].receiver == addr3);
    assert(weights[0].weight == 4);
  });

  it("Allows removing the first item", async function () {
    const weights_test = await deployReceiverWeightsTest();
    const addr1 = await addr(1);
    const addr2 = await addr(2);
    const addr3 = await addr(3);

    const tx = await weights_test.setWeights([
      {receiver: addr1, weight: 1},
      {receiver: addr2, weight: 2},
      {receiver: addr3, weight: 4},
      {receiver: addr3, weight: 0},
    ]);

    console.log("Gas used: ", (await tx.wait()).gasUsed.toString());
    assert((await weights_test.receiverWeightsSumDelta()).eq(1 + 2 + 4 - 4));
    const weights = await weights_test.getReceiverWeightsIterated();
    assert(weights.length == 2);
    assert(weights[0].receiver == addr2);
    assert(weights[0].weight == 2);
    assert(weights[1].receiver == addr1);
    assert(weights[1].weight == 1);
  });

  it("Allows removing two first items", async function () {
    const weights_test = await deployReceiverWeightsTest();
    const addr1 = await addr(1);
    const addr2 = await addr(2);
    const addr3 = await addr(3);

    const tx = await weights_test.setWeights([
      {receiver: addr1, weight: 1},
      {receiver: addr2, weight: 2},
      {receiver: addr3, weight: 4},
      {receiver: addr2, weight: 0},
      {receiver: addr3, weight: 0},
    ]);

    console.log("Gas used: ", (await tx.wait()).gasUsed.toString());
    assert(
      (await weights_test.receiverWeightsSumDelta()).eq(1 + 2 + 4 - 2 - 4)
    );
    const weights = await weights_test.getReceiverWeightsIterated();
    assert(weights.length == 1);
    assert(weights[0].receiver == addr1);
    assert(weights[0].weight == 1);
  });

  it("Allows removing the middle item", async function () {
    const weights_test = await deployReceiverWeightsTest();
    const addr1 = await addr(1);
    const addr2 = await addr(2);
    const addr3 = await addr(3);

    const tx = await weights_test.setWeights([
      {receiver: addr1, weight: 1},
      {receiver: addr2, weight: 2},
      {receiver: addr3, weight: 4},
      {receiver: addr2, weight: 0},
    ]);

    console.log("Gas used: ", (await tx.wait()).gasUsed.toString());
    assert((await weights_test.receiverWeightsSumDelta()).eq(1 + 2 + 4 - 2));
    const weights = await weights_test.getReceiverWeightsIterated();
    assert(weights.length == 2);
    assert(weights[0].receiver == addr3);
    assert(weights[0].weight == 4);
    assert(weights[1].receiver == addr1);
    assert(weights[1].weight == 1);
  });

  it("Allows removing two middle items", async function () {
    const weights_test = await deployReceiverWeightsTest();
    const addr1 = await addr(1);
    const addr2 = await addr(2);
    const addr3 = await addr(3);
    const addr4 = await addr(4);

    const tx = await weights_test.setWeights([
      {receiver: addr1, weight: 1},
      {receiver: addr2, weight: 2},
      {receiver: addr3, weight: 4},
      {receiver: addr4, weight: 8},
      {receiver: addr2, weight: 0},
      {receiver: addr3, weight: 0},
    ]);

    console.log("Gas used: ", (await tx.wait()).gasUsed.toString());
    assert(
      (await weights_test.receiverWeightsSumDelta()).eq(1 + 2 + 4 + 8 - 2 - 4)
    );
    const weights = await weights_test.getReceiverWeightsIterated();
    assert(weights.length == 2);
    assert(weights[0].receiver == addr4);
    assert(weights[0].weight == 8);
    assert(weights[1].receiver == addr1);
    assert(weights[1].weight == 1);
  });

  it("Allows removing all items", async function () {
    const weights_test = await deployReceiverWeightsTest();
    const addr1 = await addr(1);
    const addr2 = await addr(2);
    const addr3 = await addr(3);

    const tx = await weights_test.setWeights([
      {receiver: addr1, weight: 1},
      {receiver: addr2, weight: 2},
      {receiver: addr3, weight: 4},
      {receiver: addr1, weight: 0},
      {receiver: addr2, weight: 0},
      {receiver: addr3, weight: 0},
    ]);

    console.log("Gas used: ", (await tx.wait()).gasUsed.toString());
    assert(
      (await weights_test.receiverWeightsSumDelta()).eq(1 + 2 + 4 - 1 - 2 - 4)
    );
    const weights = await weights_test.getReceiverWeightsIterated();
    assert(weights.length == 0);
  });

  it("Allows updating the first item", async function () {
    const weights_test = await deployReceiverWeightsTest();
    const addr1 = await addr(1);
    const addr2 = await addr(2);
    const addr3 = await addr(3);

    const tx = await weights_test.setWeights([
      {receiver: addr1, weight: 1},
      {receiver: addr2, weight: 2},
      {receiver: addr3, weight: 4},
      {receiver: addr3, weight: 8},
    ]);

    console.log("Gas used: ", (await tx.wait()).gasUsed.toString());
    assert(
      (await weights_test.receiverWeightsSumDelta()).eq(1 + 2 + 4 - 4 + 8)
    );
    const weights = await weights_test.getReceiverWeightsIterated();
    assert(weights.length == 3);
    assert(weights[0].receiver == addr3);
    assert(weights[0].weight == 8);
    assert(weights[1].receiver == addr2);
    assert(weights[1].weight == 2);
    assert(weights[2].receiver == addr1);
    assert(weights[2].weight == 1);
  });

  it("Allows updating the middle item", async function () {
    const weights_test = await deployReceiverWeightsTest();
    const addr1 = await addr(1);
    const addr2 = await addr(2);
    const addr3 = await addr(3);

    const tx = await weights_test.setWeights([
      {receiver: addr1, weight: 1},
      {receiver: addr2, weight: 2},
      {receiver: addr3, weight: 4},
      {receiver: addr2, weight: 8},
    ]);

    console.log("Gas used: ", (await tx.wait()).gasUsed.toString());
    assert(
      (await weights_test.receiverWeightsSumDelta()).eq(1 + 2 + 4 - 2 + 8)
    );
    const weights = await weights_test.getReceiverWeightsIterated();
    assert(weights.length == 3);
    assert(weights[0].receiver == addr3);
    assert(weights[0].weight == 4);
    assert(weights[1].receiver == addr2);
    assert(weights[1].weight == 8);
    assert(weights[2].receiver == addr1);
    assert(weights[2].weight == 1);
  });

  it("Allows updating the last item", async function () {
    const weights_test = await deployReceiverWeightsTest();
    const addr1 = await addr(1);
    const addr2 = await addr(2);
    const addr3 = await addr(3);

    const tx = await weights_test.setWeights([
      {receiver: addr1, weight: 1},
      {receiver: addr2, weight: 2},
      {receiver: addr3, weight: 4},
      {receiver: addr1, weight: 8},
    ]);

    console.log("Gas used: ", (await tx.wait()).gasUsed.toString());
    assert(
      (await weights_test.receiverWeightsSumDelta()).eq(1 + 2 + 4 - 1 + 8)
    );
    const weights = await weights_test.getReceiverWeightsIterated();
    assert(weights.length == 3);
    assert(weights[0].receiver == addr3);
    assert(weights[0].weight == 4);
    assert(weights[1].receiver == addr2);
    assert(weights[1].weight == 2);
    assert(weights[2].receiver == addr1);
    assert(weights[2].weight == 8);
  });
});
