import {
  PoolFactory,
  ReceiverWeightsTestFactory,
} from "../contract-bindings/ethers";
import {Pool} from "../contract-bindings/ethers/Pool";
import {ReceiverWeightsTest} from "../contract-bindings/ethers/ReceiverWeightsTest";
import buidler from "@nomiclabs/buidler";
import {Signer} from "ethers";
import {assert, expect} from "chai";

async function addr(idx: number): Promise<string> {
  return await (await buidler.ethers.getSigners())[idx].getAddress();
}

const CYCLE_BLOCKS = 10;

async function deployPool(signer: Signer): Promise<Pool> {
  return new PoolFactory(signer)
    .deploy(CYCLE_BLOCKS)
    .then((pool) => pool.deployed());
}

async function mineBlocksUntilCycleEnd(): Promise<void> {
  const blockNumber = await buidler.ethers.provider.getBlockNumber();
  await mineBlocks(CYCLE_BLOCKS - (blockNumber % CYCLE_BLOCKS));
}

async function mineBlocks(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await buidler.ethers.provider.send("evm_mine", []);
  }
}

describe("Pool", function () {
  it("Sends some funds between accounts", async function () {
    const [sender, receiver] = await buidler.ethers.getSigners();
    const receiverAddr = await receiver.getAddress();
    const senderPool = await deployPool(sender);
    await mineBlocksUntilCycleEnd();

    // Start sending
    await senderPool.topUp({value: 100});
    await senderPool.setAmountPerBlock(1);
    await senderPool.setReceiver(receiverAddr, 1);
    await mineBlocksUntilCycleEnd(); // 7 blocks left until cycle end
    await mineBlocksUntilCycleEnd();
    const receiverPool = senderPool.connect(receiver);

    // Collect what was sent
    let balanceBefore = await receiver.getBalance();
    await receiverPool.collect({gasPrice: 0});
    let received = (await receiver.getBalance()).sub(balanceBefore).toNumber();
    // 17 blocks have passed in finished cycles since funding started
    expect(received).to.equal(17);
    await mineBlocksUntilCycleEnd();

    // Withdraw what is left
    balanceBefore = await sender.getBalance();
    // 27 blocks have passed before withdrawal and one during
    await senderPool.withdraw(72, {gasPrice: 0});
    received = (await sender.getBalance()).sub(balanceBefore).toNumber();
    expect(received).to.equal(72);
    await mineBlocksUntilCycleEnd();

    expect(await (await senderPool.withdrawable()).toNumber()).to.equal(0);

    // Collect what was sent before withdrawal
    await mineBlocksUntilCycleEnd();
    balanceBefore = await receiver.getBalance();
    await receiverPool.collect({gasPrice: 0});
    received = (await receiver.getBalance()).sub(balanceBefore).toNumber();
    // Sender sent 28, 17 was withdrawn before
    expect(received).to.equal(11);
    await mineBlocksUntilCycleEnd();
  });
});

async function deployReceiverWeightsTest(): Promise<ReceiverWeightsTest> {
  const [signer] = await buidler.ethers.getSigners();
  return new ReceiverWeightsTestFactory(signer)
    .deploy()
    .then((weights) => weights.deployed());
}

describe("ReceiverWeights", function () {
  it("Is empty on the beginning", async function () {
    const weights_test = await deployReceiverWeightsTest();

    await weights_test.setWeights([]);

    assert((await weights_test.receiverWeightsSumDelta()).eq(0));
    const weights = await weights_test.getReceiverWeightsIterated();
    assert(weights.length == 0);
  });

  it("Keeps a single added item", async function () {
    const weights_test = await deployReceiverWeightsTest();
    const addr1 = await addr(1);

    await weights_test.setWeights([{receiver: addr1, weight: 1}]);

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

    await weights_test.setWeights([
      {receiver: addr1, weight: 1},
      {receiver: addr2, weight: 2},
      {receiver: addr3, weight: 4},
    ]);

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

    await weights_test.setWeights([
      {receiver: addr1, weight: 1},
      {receiver: addr2, weight: 2},
      {receiver: addr3, weight: 4},
      {receiver: addr1, weight: 0},
    ]);

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

    await weights_test.setWeights([
      {receiver: addr1, weight: 1},
      {receiver: addr2, weight: 2},
      {receiver: addr3, weight: 4},
      {receiver: addr1, weight: 0},
      {receiver: addr2, weight: 0},
    ]);

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

    await weights_test.setWeights([
      {receiver: addr1, weight: 1},
      {receiver: addr2, weight: 2},
      {receiver: addr3, weight: 4},
      {receiver: addr3, weight: 0},
    ]);

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

    await weights_test.setWeights([
      {receiver: addr1, weight: 1},
      {receiver: addr2, weight: 2},
      {receiver: addr3, weight: 4},
      {receiver: addr2, weight: 0},
      {receiver: addr3, weight: 0},
    ]);

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

    await weights_test.setWeights([
      {receiver: addr1, weight: 1},
      {receiver: addr2, weight: 2},
      {receiver: addr3, weight: 4},
      {receiver: addr2, weight: 0},
    ]);

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

    await weights_test.setWeights([
      {receiver: addr1, weight: 1},
      {receiver: addr2, weight: 2},
      {receiver: addr3, weight: 4},
      {receiver: addr4, weight: 8},
      {receiver: addr2, weight: 0},
      {receiver: addr3, weight: 0},
    ]);

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

    await weights_test.setWeights([
      {receiver: addr1, weight: 1},
      {receiver: addr2, weight: 2},
      {receiver: addr3, weight: 4},
      {receiver: addr1, weight: 0},
      {receiver: addr2, weight: 0},
      {receiver: addr3, weight: 0},
    ]);

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

    await weights_test.setWeights([
      {receiver: addr1, weight: 1},
      {receiver: addr2, weight: 2},
      {receiver: addr3, weight: 4},
      {receiver: addr3, weight: 8},
    ]);

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

    await weights_test.setWeights([
      {receiver: addr1, weight: 1},
      {receiver: addr2, weight: 2},
      {receiver: addr3, weight: 4},
      {receiver: addr2, weight: 8},
    ]);

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

    await weights_test.setWeights([
      {receiver: addr1, weight: 1},
      {receiver: addr2, weight: 2},
      {receiver: addr3, weight: 4},
      {receiver: addr1, weight: 8},
    ]);

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
