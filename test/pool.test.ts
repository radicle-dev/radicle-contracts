import {
  PoolFactory,
  ReceiverWeightsTestFactory,
} from "../contract-bindings/ethers";
import {Pool} from "../contract-bindings/ethers/Pool";
import {ReceiverWeightsTest} from "../contract-bindings/ethers/ReceiverWeightsTest";
import buidler from "@nomiclabs/buidler";
import {Signer, BigNumber, BigNumberish, ethers} from "ethers";
import {assert, expect} from "chai";

async function addr(idx: number): Promise<string> {
  return await (await buidler.ethers.getSigners())[idx].getAddress();
}

function randomAddress(): string {
  return numberToAddress(ethers.utils.randomBytes(20));
}

function numberToAddress(num: BigNumberish): string {
  const hex = ethers.utils.hexlify(num);
  const padded = ethers.utils.hexZeroPad(hex, 20);
  return ethers.utils.getAddress(padded);
}

function getRevertCause(error: Error): string {
  return error.message.replace(
    "VM Exception while processing transaction: revert ",
    ""
  );
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
async function callOnNextBlock<T>(fn: () => Promise<T>): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const snapshot = await buidler.ethers.provider.send("evm_snapshot", []);
  await mineBlocks(1);
  const returned = await fn();
  await buidler.ethers.provider.send("evm_revert", [snapshot]);
  return returned;
}

const CYCLE_BLOCKS = 10;

async function getPoolUsers(): Promise<PoolUser[]> {
  const signers = await buidler.ethers.getSigners();
  const pool = await deployPool(signers[0]);
  const poolSigners = signers.map(
    async (signer: Signer) =>
      <PoolUser>{
        pool: pool.connect(signer),
        addr: await signer.getAddress(),
      }
  );
  return Promise.all(poolSigners);
}

interface PoolUser {
  pool: Pool;
  addr: string;
}

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
  await expectReceivers(pool, receivers);
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

async function expectSetReceiverReverts(
  pool: Pool,
  address: string,
  weight: number,
  expectedCause: string
): Promise<void> {
  try {
    await pool.setReceiver(address, weight);
  } catch (error) {
    expect(getRevertCause(error)).to.equal(
      expectedCause,
      "setReceiver failed because of an unexpected reason"
    );
    return;
  }
  expect.fail("setReceiver should have failed");
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
  it("Sends funds from a single sender to a single receiver", async function () {
    const [sender, receiver] = await getPoolUsers();
    await topUp(sender.pool, 0, 100);
    await setAmountPerBlock(sender.pool, 1);
    await setReceiver(sender.pool, receiver.addr, 1);
    await mineBlocks(15);
    // Sender had 16 blocks paying 1 per block
    await withdraw(sender.pool, 84, 0);
    await mineBlocksUntilCycleEnd();
    // Sender had 16 blocks paying 1 per block
    await collect(receiver.pool, 16);
  });

  it("Sends some funds from a single sender to two receivers", async function () {
    const [sender, receiver1, receiver2] = await getPoolUsers();
    await topUp(sender.pool, 0, 100);
    await setAmountPerBlock(sender.pool, 2);
    await setReceiver(sender.pool, receiver1.addr, 1);
    await setReceiver(sender.pool, receiver2.addr, 1);
    await mineBlocks(13);
    // Sender had 15 blocks paying 2 per block
    await withdraw(sender.pool, 70, 0);
    await mineBlocksUntilCycleEnd();
    // Receiver 1 had 1 block paying 2 per block and 14 blocks paying 1 per block
    await collect(receiver1.pool, 16);
    // Receiver 2 had 14 blocks paying 1 per block
    await collect(receiver2.pool, 14);
  });

  it("Sends some funds from a two senders to a single receiver", async function () {
    const [sender1, sender2, receiver] = await getPoolUsers();
    await topUp(sender1.pool, 0, 100);
    await setAmountPerBlock(sender1.pool, 1);
    await topUp(sender2.pool, 0, 100);
    await setAmountPerBlock(sender2.pool, 2);
    await setReceiver(sender1.pool, receiver.addr, 1);
    await setReceiver(sender2.pool, receiver.addr, 1);
    await mineBlocks(14);
    // Sender2 had 15 blocks paying 2 per block
    await withdraw(sender2.pool, 70, 0);
    // Sender1 had 17 blocks paying 1 per block
    await withdraw(sender1.pool, 83, 0);
    await mineBlocksUntilCycleEnd();
    // Receiver had 15 blocks paying 3 per block and 2 blocks paying 1 per block
    await collect(receiver.pool, 47);
  });

  it("Does not require receiver to be initialized", async function () {
    const [receiver] = await getPoolUsers();
    await collect(receiver.pool, 0);
  });

  it("Allows collecting funds while they are being sent", async function () {
    const [sender, receiver] = await getPoolUsers();
    await topUp(sender.pool, 0, CYCLE_BLOCKS + 10);
    await setAmountPerBlock(sender.pool, 1);
    await mineBlocksUntilCycleEnd();
    await setReceiver(sender.pool, receiver.addr, 1);
    await mineBlocksUntilCycleEnd();
    // Receiver had CYCLE_BLOCKS blocks paying 1 per block
    await collect(receiver.pool, CYCLE_BLOCKS);
    await mineBlocks(6);
    // Sender had CYCLE_BLOCKS + 7 blocks paying 1 per block
    await withdraw(sender.pool, 3, 0);
    await mineBlocksUntilCycleEnd();
    // Receiver had 7 blocks paying 1 per block
    await collect(receiver.pool, 7);
  });

  it("Sends funds until they run out", async function () {
    const [sender, receiver] = await getPoolUsers();
    await topUp(sender.pool, 0, 100);
    await setAmountPerBlock(sender.pool, 9);
    await setReceiver(sender.pool, receiver.addr, 1);
    await mineBlocks(9);
    // Sender had 10 blocks paying 9 per block, funds are about to run out
    await expectWithdrawableOnNextBlock(sender.pool, 10);
    // Sender had 11 blocks paying 9 per block, funds have run out
    await mineBlocks(1);
    await expectWithdrawableOnNextBlock(sender.pool, 1);
    // Nothing more will be sent
    await mineBlocksUntilCycleEnd();
    await collect(receiver.pool, 99);
    await withdraw(sender.pool, 1, 0);
  });

  it("Allows topping up while sending", async function () {
    const [sender, receiver] = await getPoolUsers();
    await topUp(sender.pool, 0, 100);
    await setAmountPerBlock(sender.pool, 10);
    await setReceiver(sender.pool, receiver.addr, 1);
    await mineBlocks(5);
    // Sender had 6 blocks paying 10 per block
    await topUp(sender.pool, 40, 60);
    await mineBlocks(4);
    // Sender had 5 blocks paying 10 per block
    await withdraw(sender.pool, 10, 0);
    await mineBlocksUntilCycleEnd();
    // Receiver had 11 blocks paying 10 per block
    await collect(receiver.pool, 110);
  });

  it("Allows topping up after funds run out", async function () {
    const [sender, receiver] = await getPoolUsers();
    await topUp(sender.pool, 0, 100);
    await setAmountPerBlock(sender.pool, 10);
    await setReceiver(sender.pool, receiver.addr, 1);
    await mineBlocks(20);
    // Sender had 10 blocks paying 10 per block
    await expectWithdrawable(sender.pool, 0);
    await mineBlocksUntilCycleEnd();
    // Receiver had 10 blocks paying 10 per block
    await expectCollectableOnNextBlock(receiver.pool, 100);
    await topUp(sender.pool, 0, 60);
    await mineBlocks(4);
    // Sender had 5 blocks paying 10 per block
    await withdraw(sender.pool, 10, 0);
    await mineBlocksUntilCycleEnd();
    // Receiver had 15 blocks paying 10 per block
    await collect(receiver.pool, 150);
  });

  it("Allows sending, which should end after block number 2^64", async function () {
    const [sender, receiver] = await getPoolUsers();
    const toppedUp = BigNumber.from(2).pow(64).add(5);
    await sender.pool.topUp({value: toppedUp});
    const withdrawable = await sender.pool.withdrawable();
    expect(withdrawable.toString()).to.equal(
      toppedUp.toString(),
      "The withdrawable amount is different from the expected amount"
    );
    await setAmountPerBlock(sender.pool, 1);
    await setReceiver(sender.pool, receiver.addr, 1);
    await mineBlocks(9);
    // Sender had 10 blocks paying 1 per block
    await sender.pool.withdraw(toppedUp.sub(10));
    await expectWithdrawable(sender.pool, 0);
    await mineBlocksUntilCycleEnd();
    // Receiver had 10 blocks paying 1 per block
    await collect(receiver.pool, 10);
  });

  it("Allows changing amount per block while sending", async function () {
    const [sender, receiver] = await getPoolUsers();
    await topUp(sender.pool, 0, 100);
    await setAmountPerBlock(sender.pool, 10);
    await setReceiver(sender.pool, receiver.addr, 1);
    await mineBlocks(3);
    await setAmountPerBlock(sender.pool, 9);
    await mineBlocks(3);
    // Sender had 4 blocks paying 10 per block and 4 blocks paying 9 per block
    await withdraw(sender.pool, 24, 0);
    await mineBlocksUntilCycleEnd();
    // Receiver had 4 blocks paying 10 per block and 4 blocks paying 9 per block
    await collect(receiver.pool, 76);
  });

  it("Sends amount per block rounded down to a multiple of weights sum", async function () {
    const [sender, receiver] = await getPoolUsers();
    await topUp(sender.pool, 0, 100);
    await setAmountPerBlock(sender.pool, 9);
    await setReceiver(sender.pool, receiver.addr, 5);
    await mineBlocks(4);
    // Sender had 5 blocks paying 5 per block
    await withdraw(sender.pool, 75, 0);
    await mineBlocksUntilCycleEnd();
    // Receiver had 5 blocks paying 5 per block
    await collect(receiver.pool, 25);
  });

  it("Sends nothing if amount per block is smaller than weights sum", async function () {
    const [sender, receiver] = await getPoolUsers();
    await topUp(sender.pool, 0, 100);
    await setAmountPerBlock(sender.pool, 4);
    await setReceiver(sender.pool, receiver.addr, 5);
    await mineBlocks(4);
    // Sender had no paying blocks
    await withdraw(sender.pool, 100, 0);
    await mineBlocksUntilCycleEnd();
    // Receiver had no paying blocks
    await collect(receiver.pool, 0);
  });

  it("Allows changing receiver weights while sending", async function () {
    const [sender, receiver1, receiver2] = await getPoolUsers();
    await topUp(sender.pool, 0, 100);
    await setReceiver(sender.pool, receiver1.addr, 1);
    await setReceiver(sender.pool, receiver2.addr, 1);
    await setAmountPerBlock(sender.pool, 12);
    await mineBlocks(2);
    await setReceiver(sender.pool, receiver2.addr, 2);
    await mineBlocks(3);
    // Sender had 7 blocks paying 12 per block
    await withdraw(sender.pool, 16, 0);
    await mineBlocksUntilCycleEnd();
    // Receiver1 had 3 blocks paying 6 per block and 4 blocks paying 4 per block
    await collect(receiver1.pool, 34);
    // Receiver2 had 3 blocks paying 6 per block and 4 blocks paying 8 per block
    await collect(receiver2.pool, 50);
  });

  it("Allows removing receivers while sending", async function () {
    const [sender, receiver1, receiver2] = await getPoolUsers();
    await topUp(sender.pool, 0, 100);
    await setReceiver(sender.pool, receiver1.addr, 1);
    await setReceiver(sender.pool, receiver2.addr, 1);
    await setAmountPerBlock(sender.pool, 10);
    await mineBlocks(2);
    await setReceiver(sender.pool, receiver1.addr, 0);
    await mineBlocks(3);
    await setReceiver(sender.pool, receiver2.addr, 0);
    await mineBlocks(10);
    // Sender had 7 blocks paying 10 per block
    await withdraw(sender.pool, 30, 0);
    await mineBlocksUntilCycleEnd();
    // Receiver1 had 3 blocks paying 5 per block
    await collect(receiver1.pool, 15);
    // Receiver2 had 3 blocks paying 5 per block and 4 blocks paying 10 per block
    await collect(receiver2.pool, 55);
  });

  it("Limits the total weights sum", async function () {
    const [sender, receiver1, receiver2] = await getPoolUsers();
    const weightsSumMax = await sender.pool.SENDER_WEIGHTS_SUM_MAX();
    await setReceiver(sender.pool, receiver1.addr, weightsSumMax);
    await expectSetReceiverReverts(
      sender.pool,
      receiver2.addr,
      1,
      "Too much total receivers weight"
    );
  });

  it("Limits the total receivers count", async function () {
    const [sender] = await getPoolUsers();
    const weightsCountMax = await sender.pool.SENDER_WEIGHTS_COUNT_MAX();
    let receiverIdx = 0;
    for (; receiverIdx < weightsCountMax; receiverIdx++) {
      // This is much faster than using the `setReceiver()` test utility
      await sender.pool.setReceiver(randomAddress(), 1);
    }
    await expectSetReceiverReverts(
      sender.pool,
      randomAddress(),
      1,
      "Too many receivers"
    );
  });
});

async function deployReceiverWeightsTest(): Promise<ReceiverWeightsTest> {
  const [signer] = await buidler.ethers.getSigners();
  return new ReceiverWeightsTestFactory(signer)
    .deploy()
    .then((weights) => weights.deployed());
}

async function expectSetWeightsWithInvalidAddressReverts(
  weights_test: ReceiverWeightsTest,
  weights: {receiver: string; weight: BigNumberish}[]
): Promise<void> {
  try {
    await weights_test.setWeights(weights);
  } catch (error) {
    expect(getRevertCause(error)).to.equal(
      "Invalid receiver address",
      "setWeights failed because of an unexpected reason"
    );
    return;
  }
  expect.fail("setWeights should have failed");
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

  it("Rejects setting weight for address 0", async function () {
    const weights_test = await deployReceiverWeightsTest();
    await expectSetWeightsWithInvalidAddressReverts(weights_test, [
      {receiver: numberToAddress(0), weight: 1},
    ]);
  });

  it("Rejects setting weight for address 1", async function () {
    const weights_test = await deployReceiverWeightsTest();
    await expectSetWeightsWithInvalidAddressReverts(weights_test, [
      {receiver: numberToAddress(1), weight: 1},
    ]);
  });
});
