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

// Call a function `fn` on the next block to be mined without actually mining it.
//
// This is needed because of the way the test EVM is working.
// When a non-`view` contract function is called, a new block is created, then the
// function is called and then the block is mined.
// On the other hand `view` functions are called on the last block, without mining.
// It means that `view` functions are called on block `N`, but non-view on `N+1`.
// It may be problematic in some tests, because they will see slightly different blockchain states.
// This function allows a `view` function to see exactly the same state as the next non-`view` one.
async function callOnNextBlock<T>(fn: () => T): Promise<T> {
  const snapshot = await buidler.ethers.provider.send("evm_snapshot", []);
  await mineBlocks(1);
  const returned = await fn();
  await buidler.ethers.provider.send("evm_revert", [snapshot]);
  return returned;
}

const CYCLE_BLOCKS = 10;

async function deployPool(signer: Signer): Promise<Pool> {
  return new PoolFactory(signer)
    .deploy(CYCLE_BLOCKS)
    .then((pool) => pool.deployed());
}

// The next transaction will be executed on the first block of the next cycle,
// but the next call will be executed on the last block of the current cycle
async function mineBlocksUntilCycleEnd(): Promise<void> {
  const blockNumber = await buidler.ethers.provider.getBlockNumber();
  await mineBlocks(CYCLE_BLOCKS - ((blockNumber + 1) % CYCLE_BLOCKS));
}

async function mineBlocks(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await buidler.ethers.provider.send("evm_mine", []);
  }
}

async function collect(pool: Pool, amount: number): Promise<void> {
  await expectCollectableOnNextBlock(pool, amount);
  const balanceBefore = await pool.signer.getBalance();
  await pool.collect({gasPrice: 0});
  const balanceAfter = await pool.signer.getBalance();
  const collected = balanceAfter.sub(balanceBefore).toNumber();
  expect(collected).to.equal(
    amount,
    "The collected amount is different from the expected amount"
  );
  await expectCollectable(pool, 0);
}

async function setAmountPerBlock(pool: Pool, amount: number): Promise<void> {
  await pool.setAmountPerBlock(amount);
  await expectAmountPerBlock(pool, amount);
}

async function setReceiver(
  pool: Pool,
  address: string,
  weight: number
): Promise<void> {
  const receivers = await getAllReceivers(pool);
  await pool.setReceiver(address, weight);
  if (weight == 0) {
    receivers.delete(address);
  } else {
    receivers.set(address, weight);
  }
  expectReceivers(pool, receivers);
}

async function getAllReceivers(pool: Pool): Promise<Map<string, number>> {
  const receivers = await pool.getAllReceivers();
  return new Map(receivers.map(({receiver, weight}) => [receiver, weight]));
}

async function topUp(
  pool: Pool,
  amountFrom: number,
  amountTo: number
): Promise<void> {
  await expectWithdrawableOnNextBlock(pool, amountFrom);
  await pool.topUp({value: amountTo - amountFrom});
  await expectWithdrawable(pool, amountTo);
}

async function withdraw(
  pool: Pool,
  amountFrom: number,
  amountTo: number
): Promise<void> {
  await expectWithdrawableOnNextBlock(pool, amountFrom);
  const amount = amountFrom - amountTo;
  const balanceBefore = await pool.signer.getBalance();
  await pool.withdraw(amount, {gasPrice: 0});
  const balanceAfter = await pool.signer.getBalance();
  const withdrawn = balanceAfter.sub(balanceBefore).toNumber();
  expect(withdrawn).to.equal(
    amount,
    "The withdrawn amount is different from the requested amount"
  );
  await expectWithdrawable(pool, amountTo);
}

async function expectCollectableOnNextBlock(
  pool: Pool,
  amount: number
): Promise<void> {
  await callOnNextBlock(async () => {
    await expectCollectable(pool, amount);
  });
}

async function expectCollectable(pool: Pool, amount: number): Promise<void> {
  const collectable = (await pool.collectable()).toNumber();
  expect(collectable).to.equal(
    amount,
    "The collectable amount is different from the expected amount"
  );
}

async function expectWithdrawableOnNextBlock(
  pool: Pool,
  amount: number
): Promise<void> {
  await callOnNextBlock(async () => {
    await expectWithdrawable(pool, amount);
  });
}

async function expectWithdrawable(pool: Pool, amount: number): Promise<void> {
  const withdrawable = (await pool.withdrawable()).toNumber();
  expect(withdrawable).to.equal(
    amount,
    "The withdrawable amount is different from the expected amount"
  );
}

async function expectAmountPerBlock(pool: Pool, amount: number): Promise<void> {
  const actualAmount = (await pool.getAmountPerBlock()).toNumber();
  expect(actualAmount).to.equal(
    amount,
    "The amount per block is different from the expected amount"
  );
}

async function expectReceivers(
  pool: Pool,
  receivers: Map<string, number>
): Promise<void> {
  const receiversActual = await getAllReceivers(pool);
  expect(receiversActual).to.deep.equal(receivers, "Unexpected receivers list");
}

describe("Pool", function () {
  it("Sends some funds between accounts", async function () {
    const [sender, receiver] = await buidler.ethers.getSigners();
    const receiverAddr = await receiver.getAddress();
    const senderPool = await deployPool(sender);
    const receiverPool = senderPool.connect(receiver);

    await mineBlocksUntilCycleEnd();
    // Start sending
    await topUp(senderPool, 0, 100);
    await setAmountPerBlock(senderPool, 1);
    await setReceiver(senderPool, receiverAddr, 1);
    await mineBlocksUntilCycleEnd();
    await mineBlocksUntilCycleEnd();

    // Collect what was sent, 18 paying blocks have passed in finished cycles since funding started
    await collect(receiverPool, 18);

    await mineBlocksUntilCycleEnd();
    // Withdraw what is left, 28 paying blocks have passed since funding started
    await withdraw(senderPool, 72, 0);

    await mineBlocksUntilCycleEnd();
    // Collect what was sent before withdrawal, sender sent 28, 18 was withdrawn before
    await collect(receiverPool, 10);
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
