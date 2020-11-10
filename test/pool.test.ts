import {
  Erc20PoolFactory,
  EthPoolFactory,
  RadFactory,
} from "../contract-bindings/ethers";
import {Erc20} from "../contract-bindings/ethers/Erc20";
import {Erc20Pool} from "../contract-bindings/ethers/Erc20Pool";
import {EthPool} from "../contract-bindings/ethers/EthPool";
import buidler from "@nomiclabs/buidler";
import {Signer, BigNumber} from "ethers";
import {expect} from "chai";
import {
  randomAddress,
  mineBlocks,
  callOnNextBlock,
  submit,
  submitFailing,
} from "./support";

const CYCLE_BLOCKS = 10;

// The next transaction will be executed on the first block of the next cycle,
// but the next call will be executed on the last block of the current cycle
async function mineBlocksUntilCycleEnd(): Promise<void> {
  const blockNumber = await buidler.ethers.provider.getBlockNumber();
  await mineBlocks(CYCLE_BLOCKS - ((blockNumber + 1) % CYCLE_BLOCKS));
}

type AnyPool = EthPool | Erc20Pool;

abstract class PoolUser {
  pool: AnyPool;
  // The address of the user
  addr: string;

  constructor(pool: AnyPool, addr: string) {
    this.pool = pool;
    this.addr = addr;
  }

  async setAmountPerBlock(amount: number): Promise<void> {
    await submit(this.pool.setAmountPerBlock(amount), "setAmountPerBlock");
    await this.expectAmountPerBlock(amount);
  }

  async setReceiver(receiver: this, weight: number): Promise<void> {
    const receivers = await this.getAllReceivers();
    await submit(this.pool.setReceiver(receiver.addr, weight), "setReceiver");
    if (weight == 0) {
      receivers.delete(receiver.addr);
    } else {
      receivers.set(receiver.addr, weight);
    }
    await this.expectReceivers(receivers);
  }

  async getAllReceivers(): Promise<Map<string, number>> {
    const receivers = await this.pool.getAllReceivers();
    return new Map(receivers.map(({receiver, weight}) => [receiver, weight]));
  }

  async expectSetReceiverReverts(
    receiver: this,
    weight: number,
    expectedCause: string
  ): Promise<void> {
    await submitFailing(
      this.pool.setReceiver(receiver.addr, weight),
      "setReceiver",
      expectedCause
    );
  }

  async expectCollectableOnNextBlock(amount: number): Promise<void> {
    await callOnNextBlock(async () => {
      await this.expectCollectable(amount);
    });
  }

  async expectCollectable(amount: number): Promise<void> {
    const collectable = (await this.pool.collectable()).toNumber();
    expect(collectable).to.equal(
      amount,
      "The collectable amount is different from the expected amount"
    );
  }

  async expectWithdrawableOnNextBlock(amount: number): Promise<void> {
    await callOnNextBlock(async () => {
      await this.expectWithdrawable(amount);
    });
  }

  async expectWithdrawable(amount: number): Promise<void> {
    const withdrawable = (await this.pool.withdrawable()).toNumber();
    expect(withdrawable).to.equal(
      amount,
      "The withdrawable amount is different from the expected amount"
    );
  }

  async expectAmountPerBlock(amount: number): Promise<void> {
    const actualAmount = (await this.pool.getAmountPerBlock()).toNumber();
    expect(actualAmount).to.equal(
      amount,
      "The amount per block is different from the expected amount"
    );
  }

  async expectReceivers(receivers: Map<string, number>): Promise<void> {
    const receiversActual = await this.getAllReceivers();
    expect(receiversActual).to.deep.equal(
      receivers,
      "Unexpected receivers list"
    );
  }
}

async function getEthPoolUsers(): Promise<EthPoolUser[]> {
  const signers = await buidler.ethers.getSigners();
  const pool = await new EthPoolFactory(signers[0]).deploy(CYCLE_BLOCKS);
  await pool.deployed();
  const poolSigners = signers.map(
    async (signer: Signer) => await EthPoolUser.new(pool, signer)
  );
  return Promise.all(poolSigners);
}

class EthPoolUser extends PoolUser {
  pool: EthPool;

  constructor(pool: EthPool, addr: string) {
    super(pool, addr);
    this.pool = pool;
  }

  static async new(pool: EthPool, signer: Signer): Promise<EthPoolUser> {
    return new EthPoolUser(pool.connect(signer), await signer.getAddress());
  }

  async topUp(amountFrom: number, amountTo: number): Promise<void> {
    await this.expectWithdrawableOnNextBlock(amountFrom);
    await submit(this.pool.topUp({value: amountTo - amountFrom}), "topUp ETH");
    await this.expectWithdrawable(amountTo);
  }

  async withdraw(amountFrom: number, amountTo: number): Promise<void> {
    await this.expectWithdrawableOnNextBlock(amountFrom);
    const amount = amountFrom - amountTo;
    const balanceBefore = await this.pool.signer.getBalance();
    await submit(this.pool.withdraw(amount, {gasPrice: 0}), "withdraw ETH");
    const balanceAfter = await this.pool.signer.getBalance();
    const withdrawn = balanceAfter.sub(balanceBefore).toNumber();
    expect(withdrawn).to.equal(
      amount,
      "The withdrawn amount is different from the requested amount"
    );
    await this.expectWithdrawable(amountTo);
  }

  async collect(expectedAmount: number): Promise<void> {
    await this.expectCollectableOnNextBlock(expectedAmount);
    const balanceBefore = await this.pool.signer.getBalance();
    await submit(this.pool.collect({gasPrice: 0}), "collect ETH");
    const balanceAfter = await this.pool.signer.getBalance();
    const collected = balanceAfter.sub(balanceBefore).toNumber();
    expect(collected).to.equal(
      expectedAmount,
      "The collected amount is different from the expected amount"
    );
    await this.expectCollectable(0);
  }
}

async function getErc20PoolUsers(): Promise<Erc20PoolUser[]> {
  const signers = await buidler.ethers.getSigners();
  const signer0 = signers[0];
  const signer0Addr = await signer0.getAddress();

  const totalSupply = signers.length;
  const erc20 = await new RadFactory(signer0).deploy(signer0Addr, totalSupply);
  await erc20.deployed();

  const pool = await new Erc20PoolFactory(signer0).deploy(
    CYCLE_BLOCKS,
    erc20.address
  );
  await pool.deployed();

  const supplyPerUser = (await erc20.totalSupply()).div(signers.length);
  const users = [];
  for (const signer of signers) {
    const user = await Erc20PoolUser.new(pool, erc20, signer);
    users.push(user);
    await erc20.transfer(user.addr, supplyPerUser);
  }
  return users;
}

class Erc20PoolUser extends PoolUser {
  pool: Erc20Pool;
  erc20: Erc20;

  constructor(pool: Erc20Pool, erc20: Erc20, addr: string) {
    super(pool, addr);
    this.pool = pool;
    this.erc20 = erc20;
  }

  static async new(
    pool: Erc20Pool,
    erc20: Erc20,
    signer: Signer
  ): Promise<Erc20PoolUser> {
    const userErc20 = erc20.connect(signer);
    const uint256Max = BigNumber.from(1).shl(256).sub(1);
    await userErc20.approve(pool.address, uint256Max);
    return new Erc20PoolUser(
      pool.connect(signer),
      userErc20,
      await signer.getAddress()
    );
  }

  async topUp(amountFrom: number, amountTo: number): Promise<void> {
    const amount = amountTo - amountFrom;
    const balanceBefore = await this.erc20.balanceOf(this.pool.address);
    await this.expectWithdrawableOnNextBlock(amountFrom);
    await submit(this.pool.topUp(amount), "topUp ERC-20");
    const balanceAfter = await this.erc20.balanceOf(this.pool.address);
    const withdrawn = balanceAfter.sub(balanceBefore).toNumber();
    expect(withdrawn).to.equal(
      amount,
      "The transferred amount is different from the requested amount"
    );
    await this.expectWithdrawable(amountTo);
  }

  async withdraw(amountFrom: number, amountTo: number): Promise<void> {
    await this.expectWithdrawableOnNextBlock(amountFrom);
    const amount = amountFrom - amountTo;
    const balanceBefore = await this.erc20.balanceOf(this.addr);
    await submit(this.pool.withdraw(amount), "withdraw ERC-20");
    const balanceAfter = await this.erc20.balanceOf(this.addr);
    const withdrawn = balanceAfter.sub(balanceBefore).toNumber();
    expect(withdrawn).to.equal(
      amount,
      "The withdrawn amount is different from the requested amount"
    );
    await this.expectWithdrawable(amountTo);
  }

  async collect(expectedAmount: number): Promise<void> {
    await this.expectCollectableOnNextBlock(expectedAmount);
    const balanceBefore = await this.erc20.balanceOf(this.addr);
    await submit(this.pool.collect(), "collect ERC-20");
    const balanceAfter = await this.erc20.balanceOf(this.addr);
    const collected = balanceAfter.sub(balanceBefore).toNumber();
    expect(collected).to.equal(
      expectedAmount,
      "The collected amount is different from the expected amount"
    );
    await this.expectCollectable(0);
  }
}

describe("EthPool", function () {
  it("Sends funds from a single sender to a single receiver", async function () {
    const [sender, receiver] = await getEthPoolUsers();
    await sender.topUp(0, 100);
    await sender.setAmountPerBlock(1);
    await sender.setReceiver(receiver, 1);
    await mineBlocks(15);
    // Sender had 16 blocks paying 1 per block
    await sender.withdraw(84, 0);
    await mineBlocksUntilCycleEnd();
    // Sender had 16 blocks paying 1 per block
    await receiver.collect(16);
  });

  it("Sends some funds from a single sender to two receivers", async function () {
    const [sender, receiver1, receiver2] = await getEthPoolUsers();
    await sender.topUp(0, 100);
    await sender.setAmountPerBlock(2);
    await sender.setReceiver(receiver1, 1);
    await sender.setReceiver(receiver2, 1);
    await mineBlocks(13);
    // Sender had 15 blocks paying 2 per block
    await sender.withdraw(70, 0);
    await mineBlocksUntilCycleEnd();
    // Receiver 1 had 1 block paying 2 per block and 14 blocks paying 1 per block
    await receiver1.collect(16);
    // Receiver 2 had 14 blocks paying 1 per block
    await receiver2.collect(14);
  });

  it("Sends some funds from a two senders to a single receiver", async function () {
    const [sender1, sender2, receiver] = await getEthPoolUsers();
    await sender1.topUp(0, 100);
    await sender1.setAmountPerBlock(1);
    await sender2.topUp(0, 100);
    await sender2.setAmountPerBlock(2);
    await sender1.setReceiver(receiver, 1);
    await sender2.setReceiver(receiver, 1);
    await mineBlocks(14);
    // Sender2 had 15 blocks paying 2 per block
    await sender2.withdraw(70, 0);
    // Sender1 had 17 blocks paying 1 per block
    await sender1.withdraw(83, 0);
    await mineBlocksUntilCycleEnd();
    // Receiver had 15 blocks paying 3 per block and 2 blocks paying 1 per block
    await receiver.collect(47);
  });

  it("Does not require receiver to be initialized", async function () {
    const [receiver] = await getEthPoolUsers();
    await receiver.collect(0);
  });

  it("Allows collecting funds while they are being sent", async function () {
    const [sender, receiver] = await getEthPoolUsers();
    await sender.topUp(0, CYCLE_BLOCKS + 10);
    await sender.setAmountPerBlock(1);
    await mineBlocksUntilCycleEnd();
    await sender.setReceiver(receiver, 1);
    await mineBlocksUntilCycleEnd();
    // Receiver had CYCLE_BLOCKS blocks paying 1 per block
    await receiver.collect(CYCLE_BLOCKS);
    await mineBlocks(6);
    // Sender had CYCLE_BLOCKS + 7 blocks paying 1 per block
    await sender.withdraw(3, 0);
    await mineBlocksUntilCycleEnd();
    // Receiver had 7 blocks paying 1 per block
    await receiver.collect(7);
  });

  it("Sends funds until they run out", async function () {
    const [sender, receiver] = await getEthPoolUsers();
    await sender.topUp(0, 100);
    await sender.setAmountPerBlock(9);
    await sender.setReceiver(receiver, 1);
    await mineBlocks(9);
    // Sender had 10 blocks paying 9 per block, funds are about to run out
    await sender.expectWithdrawableOnNextBlock(10);
    // Sender had 11 blocks paying 9 per block, funds have run out
    await mineBlocks(1);
    await sender.expectWithdrawableOnNextBlock(1);
    // Nothing more will be sent
    await mineBlocksUntilCycleEnd();
    await receiver.collect(99);
    await sender.withdraw(1, 0);
  });

  it("Allows topping up while sending", async function () {
    const [sender, receiver] = await getEthPoolUsers();
    await sender.topUp(0, 100);
    await sender.setAmountPerBlock(10);
    await sender.setReceiver(receiver, 1);
    await mineBlocks(5);
    // Sender had 6 blocks paying 10 per block
    await sender.topUp(40, 60);
    await mineBlocks(4);
    // Sender had 5 blocks paying 10 per block
    await sender.withdraw(10, 0);
    await mineBlocksUntilCycleEnd();
    // Receiver had 11 blocks paying 10 per block
    await receiver.collect(110);
  });

  it("Allows topping up after funds run out", async function () {
    const [sender, receiver] = await getEthPoolUsers();
    await sender.topUp(0, 100);
    await sender.setAmountPerBlock(10);
    await sender.setReceiver(receiver, 1);
    await mineBlocks(20);
    // Sender had 10 blocks paying 10 per block
    await sender.expectWithdrawable(0);
    await mineBlocksUntilCycleEnd();
    // Receiver had 10 blocks paying 10 per block
    await receiver.expectCollectableOnNextBlock(100);
    await sender.topUp(0, 60);
    await mineBlocks(4);
    // Sender had 5 blocks paying 10 per block
    await sender.withdraw(10, 0);
    await mineBlocksUntilCycleEnd();
    // Receiver had 15 blocks paying 10 per block
    await receiver.collect(150);
  });

  it("Allows sending, which should end after block number 2^64", async function () {
    const [sender, receiver] = await getEthPoolUsers();
    const toppedUp = BigNumber.from(2).pow(64).add(5);
    await sender.pool.topUp({value: toppedUp});
    const withdrawable = await sender.pool.withdrawable();
    expect(withdrawable.toString()).to.equal(
      toppedUp.toString(),
      "The withdrawable amount is different from the expected amount"
    );
    await sender.setAmountPerBlock(1);
    await sender.setReceiver(receiver, 1);
    await mineBlocks(9);
    // Sender had 10 blocks paying 1 per block
    await sender.pool.withdraw(toppedUp.sub(10));
    await sender.expectWithdrawable(0);
    await mineBlocksUntilCycleEnd();
    // Receiver had 10 blocks paying 1 per block
    await receiver.collect(10);
  });

  it("Allows changing amount per block while sending", async function () {
    const [sender, receiver] = await getEthPoolUsers();
    await sender.topUp(0, 100);
    await sender.setAmountPerBlock(10);
    await sender.setReceiver(receiver, 1);
    await mineBlocks(3);
    await sender.setAmountPerBlock(9);
    await mineBlocks(3);
    // Sender had 4 blocks paying 10 per block and 4 blocks paying 9 per block
    await sender.withdraw(24, 0);
    await mineBlocksUntilCycleEnd();
    // Receiver had 4 blocks paying 10 per block and 4 blocks paying 9 per block
    await receiver.collect(76);
  });

  it("Sends amount per block rounded down to a multiple of weights sum", async function () {
    const [sender, receiver] = await getEthPoolUsers();
    await sender.topUp(0, 100);
    await sender.setAmountPerBlock(9);
    await sender.setReceiver(receiver, 5);
    await mineBlocks(4);
    // Sender had 5 blocks paying 5 per block
    await sender.withdraw(75, 0);
    await mineBlocksUntilCycleEnd();
    // Receiver had 5 blocks paying 5 per block
    await receiver.collect(25);
  });

  it("Sends nothing if amount per block is smaller than weights sum", async function () {
    const [sender, receiver] = await getEthPoolUsers();
    await sender.topUp(0, 100);
    await sender.setAmountPerBlock(4);
    await sender.setReceiver(receiver, 5);
    await mineBlocks(4);
    // Sender had no paying blocks
    await sender.withdraw(100, 0);
    await mineBlocksUntilCycleEnd();
    // Receiver had no paying blocks
    await receiver.collect(0);
  });

  it("Allows removing the last receiver weight when amount per block is zero", async function () {
    const [sender, receiver1, receiver2] = await getEthPoolUsers();
    await sender.topUp(0, 100);
    await sender.setReceiver(receiver1, 1);
    await sender.setReceiver(receiver2, 1);
    await sender.setReceiver(receiver2, 0);
    await sender.setAmountPerBlock(12);
    // Sender had 1 blocks paying 12 per block
    await sender.withdraw(88, 0);
    await mineBlocksUntilCycleEnd();
    // Receiver1 had 1 blocks paying 12 per block
    await receiver1.collect(12);
    // Receiver2 had 0 paying blocks
    await receiver2.expectCollectable(0);
  });

  it("Allows changing receiver weights while sending", async function () {
    const [sender, receiver1, receiver2] = await getEthPoolUsers();
    await sender.topUp(0, 100);
    await sender.setReceiver(receiver1, 1);
    await sender.setReceiver(receiver2, 1);
    await sender.setAmountPerBlock(12);
    await mineBlocks(2);
    await sender.setReceiver(receiver2, 2);
    await mineBlocks(3);
    // Sender had 7 blocks paying 12 per block
    await sender.withdraw(16, 0);
    await mineBlocksUntilCycleEnd();
    // Receiver1 had 3 blocks paying 6 per block and 4 blocks paying 4 per block
    await receiver1.collect(34);
    // Receiver2 had 3 blocks paying 6 per block and 4 blocks paying 8 per block
    await receiver2.collect(50);
  });

  it("Allows removing receivers while sending", async function () {
    const [sender, receiver1, receiver2] = await getEthPoolUsers();
    await sender.topUp(0, 100);
    await sender.setReceiver(receiver1, 1);
    await sender.setReceiver(receiver2, 1);
    await sender.setAmountPerBlock(10);
    await mineBlocks(2);
    await sender.setReceiver(receiver1, 0);
    await mineBlocks(3);
    await sender.setReceiver(receiver2, 0);
    await mineBlocks(10);
    // Sender had 7 blocks paying 10 per block
    await sender.withdraw(30, 0);
    await mineBlocksUntilCycleEnd();
    // Receiver1 had 3 blocks paying 5 per block
    await receiver1.collect(15);
    // Receiver2 had 3 blocks paying 5 per block and 4 blocks paying 10 per block
    await receiver2.collect(55);
  });

  it("Limits the total weights sum", async function () {
    const [sender, receiver1, receiver2] = await getEthPoolUsers();
    const weightsSumMax = await sender.pool.SENDER_WEIGHTS_SUM_MAX();
    await sender.setReceiver(receiver1, weightsSumMax);
    await sender.expectSetReceiverReverts(
      receiver2,
      1,
      "Too much total receivers weight"
    );
  });

  it("Limits the overflowing total weights sum", async function () {
    const [sender, receiver1, receiver2] = await getEthPoolUsers();
    await sender.setReceiver(receiver1, 1);
    await sender.expectSetReceiverReverts(
      receiver2,
      2 ** 32 - 1,
      "Too much total receivers weight"
    );
  });

  it("Limits the total receivers count", async function () {
    const [sender, receiver] = await getEthPoolUsers();
    const weightsCountMax = await sender.pool.SENDER_WEIGHTS_COUNT_MAX();
    for (let i = 0; i < weightsCountMax; i++) {
      // This is much faster than using the `setReceiver()` test utility
      await sender.pool.setReceiver(randomAddress(), 1);
    }
    await sender.expectSetReceiverReverts(receiver, 1, "Too many receivers");
  });

  it("Allows withdrawal of all funds", async function () {
    const [sender, receiver] = await getEthPoolUsers();
    const withdrawAll = await sender.pool.WITHDRAW_ALL();
    await sender.topUp(0, 10);
    await sender.setAmountPerBlock(1);
    await sender.setReceiver(receiver, 1);
    await mineBlocks(4);
    const balanceBefore = await sender.pool.signer.getBalance();
    await submit(
      sender.pool.withdraw(withdrawAll, {gasPrice: 0}),
      "withdraw ETH"
    );
    const balanceAfter = await sender.pool.signer.getBalance();
    const withdrawn = balanceAfter.sub(balanceBefore).toNumber();
    // Sender had 5 blocks paying 1 per block
    expect(withdrawn).to.equal(
      5,
      "The withdrawn amount is different from the requested amount"
    );
    await sender.expectWithdrawable(0);
    await mineBlocksUntilCycleEnd();
    // Receiver had 5 blocks paying 1 per block
    await receiver.collect(5);
  });
});

describe("Erc20Pool", function () {
  it("Allows withdrawal of funds", async function () {
    const [sender] = await getErc20PoolUsers();
    await sender.topUp(0, 10);
    await sender.withdraw(10, 0);
  });

  it("Allows collecting funds", async function () {
    const [sender, receiver] = await getErc20PoolUsers();
    await sender.topUp(0, 10);
    await sender.setAmountPerBlock(10);
    await sender.setReceiver(receiver, 1);
    await mineBlocksUntilCycleEnd();
    await receiver.collect(10);
  });
});
