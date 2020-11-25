import {
  Erc20Pool__factory,
  EthPool__factory,
  Rad__factory,
} from "../contract-bindings/ethers";
import { Erc20 } from "../contract-bindings/ethers/Erc20";
import { Erc20Pool } from "../contract-bindings/ethers/Erc20Pool";
import { EthPool } from "../contract-bindings/ethers/EthPool";
import { ethers } from "hardhat";
import { Signer, BigNumber, ContractTransaction } from "ethers";
import { expect } from "chai";
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
  const blockNumber = await ethers.provider.getBlockNumber();
  await mineBlocks(CYCLE_BLOCKS - ((blockNumber + 1) % CYCLE_BLOCKS));
}

type AnyPool = EthPool | Erc20Pool;

type ReceiverWeights = [PoolUser, number][];

function receiverWeightsForContract(
  weights: ReceiverWeights
): Array<{
  receiver: string;
  weight: number;
}> {
  return weights.map(([receiver, weight]) => ({
    receiver: receiver.addr,
    weight,
  }));
}

class ProxyReceiverWeight {
  receiverWeight: number;
  proxyWeight: number;

  constructor(receiverWeight: number, proxyWeight: number) {
    this.receiverWeight = receiverWeight;
    this.proxyWeight = proxyWeight;
  }

  static empty(): ProxyReceiverWeight {
    return new ProxyReceiverWeight(0, 0);
  }

  isEmpty(): boolean {
    return this.receiverWeight == 0 && this.proxyWeight == 0;
  }
}

type ProxyReceiverWeights = Map<string, ProxyReceiverWeight>;

function updateReceiverWeights(
  list: ProxyReceiverWeights,
  receiver: string,
  update: (weight: ProxyReceiverWeight) => void
): void {
  const receiverWeight = list.get(receiver) || ProxyReceiverWeight.empty();
  update(receiverWeight);
  if (receiverWeight.isEmpty()) {
    list.delete(receiver);
  } else {
    list.set(receiver, receiverWeight);
  }
}

abstract class PoolUser {
  pool: AnyPool;
  // The address of the user
  addr: string;

  constructor(pool: AnyPool, addr: string) {
    this.pool = pool;
    this.addr = addr;
  }

  abstract getBalance(): Promise<BigNumber>;

  abstract submitTopUp(amount: number): Promise<ContractTransaction>;

  async collect(expectedAmount: number): Promise<void> {
    await this.expectCollectableOnNextBlock(expectedAmount);
    await this.submitChangingBalance(
      () => this.pool.collect({ gasPrice: 0 }),
      "collect",
      expectedAmount
    );
    await this.expectCollectable(0);
  }

  async topUp(amountFrom: number, amountTo: number): Promise<void> {
    await this.expectWithdrawableOnNextBlock(amountFrom);
    const amount = amountTo - amountFrom;
    await this.submitChangingBalance(
      () => this.submitTopUp(amount),
      "topUp",
      -amount
    );
    await this.expectWithdrawable(amountTo);
  }

  async withdraw(amountFrom: number, amountTo: number): Promise<void> {
    await this.expectWithdrawableOnNextBlock(amountFrom);
    const amount = amountFrom - amountTo;
    await this.submitChangingBalance(
      () => this.pool.withdraw(amount, { gasPrice: 0 }),
      "withdraw",
      amount
    );
    await this.expectWithdrawable(amountTo);
  }

  async submitChangingBalance(
    fn: () => Promise<ContractTransaction>,
    txName: string,
    balanceChangeExpected: number
  ): Promise<void> {
    const balanceBefore = await this.getBalance();
    await submit(fn(), txName);
    const balanceAfter = await this.getBalance();
    const balanceChangeActual = balanceAfter.sub(balanceBefore).toNumber();
    expect(balanceChangeActual).to.equal(
      balanceChangeExpected,
      "Unexpected balance change from call to " + txName
    );
  }

  async setAmountPerBlock(amount: number): Promise<void> {
    await submit(this.pool.setAmountPerBlock(amount), "setAmountPerBlock");
    await this.expectAmountPerBlock(amount);
  }

  async setReceivers(
    receivers: ReceiverWeights,
    proxies: ReceiverWeights
  ): Promise<void> {
    const allReceivers = await this.getAllReceivers();
    const receiversAddr = receiverWeightsForContract(receivers);
    const proxiesAddr = receiverWeightsForContract(proxies);
    await submit(
      this.pool.setReceivers(receiversAddr, proxiesAddr),
      "setReceivers"
    );
    receiversAddr.forEach(({ receiver, weight }) =>
      updateReceiverWeights(
        allReceivers,
        receiver,
        (receiverWeight) => (receiverWeight.receiverWeight = weight)
      )
    );
    proxiesAddr.forEach(({ receiver, weight }) =>
      updateReceiverWeights(
        allReceivers,
        receiver,
        (receiverWeight) => (receiverWeight.proxyWeight = weight)
      )
    );
    await this.expectReceivers(allReceivers);
  }

  async setReceiver(receiver: this, weight: number): Promise<void> {
    const receivers = await this.getAllReceivers();
    await submit(this.pool.setReceiver(receiver.addr, weight), "setReceiver");
    updateReceiverWeights(
      receivers,
      receiver.addr,
      (receiverWeight) => (receiverWeight.receiverWeight = weight)
    );
    await this.expectReceivers(receivers);
  }

  async expectSetReceiverReverts(
    receiver: this,
    weight: number,
    expectedCause: string
  ): Promise<void> {
    const receivers = await this.getAllReceivers();
    await submitFailing(
      this.pool.setReceiver(receiver.addr, weight),
      "setReceiver",
      expectedCause
    );
    await this.expectReceivers(receivers);
  }

  async setProxy(receiver: this, weight: number): Promise<void> {
    const receivers = await this.getAllReceivers();
    await submit(this.pool.setProxy(receiver.addr, weight), "setProxy");
    updateReceiverWeights(
      receivers,
      receiver.addr,
      (receiverWeight) => (receiverWeight.proxyWeight = weight)
    );
    await this.expectReceivers(receivers);
  }

  async expectSetProxyReverts(
    receiver: this,
    weight: number,
    expectedCause: string
  ): Promise<void> {
    await submitFailing(
      this.pool.setProxy(receiver.addr, weight),
      "setProxy",
      expectedCause
    );
  }

  async getAllReceivers(): Promise<ProxyReceiverWeights> {
    const receivers = await this.pool.getAllReceivers();
    return new Map(
      receivers.map(({ receiver, receiverWeight, proxyWeight }) => [
        receiver,
        new ProxyReceiverWeight(receiverWeight, proxyWeight),
      ])
    );
  }

  async setProxyWeights(weights: ReceiverWeights): Promise<void> {
    const expectedWeights = await this.getProxyWeights();
    const weightsAddr = receiverWeightsForContract(weights);
    for (const { receiver, weight } of weightsAddr) {
      if (weight == 0) {
        expectedWeights.delete(receiver);
      } else {
        expectedWeights.set(receiver, weight);
      }
    }
    await submit(this.pool.setProxyWeights(weightsAddr), "setProxyWeights");
    await this.expectProxyWeights(expectedWeights);
  }

  async expectSetProxyWeightsReverts(
    weights: ReceiverWeights,
    expectedCause: string
  ): Promise<void> {
    const weightsAddr = receiverWeightsForContract(weights);
    await submitFailing(
      this.pool.setProxyWeights(weightsAddr),
      "setProxyWeights",
      expectedCause
    );
  }

  async getProxyWeights(): Promise<Map<string, number>> {
    const weights = await this.pool.getProxyWeights();
    return new Map(weights.map(({ receiver, weight }) => [receiver, weight]));
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

  async expectReceivers(receivers: ProxyReceiverWeights): Promise<void> {
    const receiversActual = await this.getAllReceivers();
    expect(receiversActual).to.deep.equal(
      receivers,
      "Unexpected receivers list"
    );
  }

  async expectProxyWeights(weights: Map<string, number>): Promise<void> {
    const weightsActual = await this.getProxyWeights();
    expect(weightsActual).to.deep.equal(
      weights,
      "Unexpected proxy weights list"
    );
  }
}

async function getEthPoolUsers(): Promise<EthPoolUser[]> {
  const signers = await ethers.getSigners();
  const pool = await new EthPool__factory(signers[0]).deploy(CYCLE_BLOCKS);
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

  async getBalance(): Promise<BigNumber> {
    return await this.pool.signer.getBalance();
  }

  async submitTopUp(amount: number): Promise<ContractTransaction> {
    return this.pool.topUp({ value: amount, gasPrice: 0 });
  }
}

async function getErc20PoolUsers(): Promise<Erc20PoolUser[]> {
  const signers = await ethers.getSigners();
  const signer0 = signers[0];
  const signer0Addr = await signer0.getAddress();

  const totalSupply = signers.length;
  const erc20 = await new Rad__factory(signer0).deploy(
    signer0Addr,
    totalSupply
  );
  await erc20.deployed();

  const pool = await new Erc20Pool__factory(signer0).deploy(
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

  async getBalance(): Promise<BigNumber> {
    return await this.erc20.balanceOf(this.addr);
  }

  async submitTopUp(amount: number): Promise<ContractTransaction> {
    return this.pool.topUp(amount);
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
    await sender.pool.topUp({ value: toppedUp });
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

  it("Allows batch setting multiple receivers and proxies", async function () {
    const [
      sender,
      receiver1,
      receiver2,
      receiver3,
      proxy1,
      proxy2,
    ] = await getEthPoolUsers();
    const proxyWeightBase = await sender.pool.PROXY_WEIGHTS_SUM();
    await proxy1.setProxyWeights([[receiver1, proxyWeightBase]]);
    await proxy2.setProxyWeights([[receiver2, proxyWeightBase]]);
    await sender.setReceivers(
      [
        [receiver1, 1],
        [receiver2, 2],
        [receiver3, 3],
      ],
      [
        [proxy1, proxyWeightBase],
        [proxy2, 2 * proxyWeightBase],
      ]
    );
  });

  it("Allows batch setting no receivers and no proxies", async function () {
    const [sender, receiver, proxy] = await getEthPoolUsers();
    const proxyWeightBase = await sender.pool.PROXY_WEIGHTS_SUM();
    await proxy.setProxyWeights([[receiver, proxyWeightBase]]);
    await sender.setReceiver(receiver, 1);
    await sender.setProxy(proxy, proxyWeightBase);
    await sender.setReceivers([], []);
  });

  it("Allows sending via a proxy", async function () {
    const [sender, proxy, receiver] = await getEthPoolUsers();
    const proxyWeightBase = await sender.pool.PROXY_WEIGHTS_SUM();
    await proxy.setProxyWeights([[receiver, proxyWeightBase]]);
    await sender.setProxy(proxy, proxyWeightBase);
    await sender.setAmountPerBlock(proxyWeightBase * 2);
    await sender.topUp(0, proxyWeightBase * 2);
    await mineBlocksUntilCycleEnd();
    await receiver.collect(proxyWeightBase * 2);
  });

  it("Allows sending to multiple proxies and receivers", async function () {
    const [
      sender,
      proxy1,
      proxy2,
      receiver1,
      receiver2,
      receiver3,
      receiver4,
    ] = await getEthPoolUsers();
    const proxyWeightBase = await sender.pool.PROXY_WEIGHTS_SUM();
    await proxy1.setProxyWeights([
      [receiver1, proxyWeightBase * 0.75],
      [receiver2, proxyWeightBase * 0.25],
    ]);
    await proxy2.setProxyWeights([[receiver3, proxyWeightBase]]);
    await sender.setProxy(proxy1, proxyWeightBase);
    await sender.setProxy(proxy2, proxyWeightBase * 2);
    await sender.setReceiver(receiver4, proxyWeightBase);
    await sender.setAmountPerBlock(proxyWeightBase * 4);
    await sender.topUp(0, proxyWeightBase * 8);
    await mineBlocks(1);
    await mineBlocksUntilCycleEnd();
    await receiver1.collect(proxyWeightBase * 1.5);
    await receiver2.collect(proxyWeightBase * 0.5);
    await receiver3.collect(proxyWeightBase * 4);
    await receiver4.collect(proxyWeightBase * 2);
  });

  it("Allows a proxy to have multiple senders", async function () {
    const [sender1, sender2, proxy, receiver] = await getEthPoolUsers();
    const proxyWeightBase = await sender1.pool.PROXY_WEIGHTS_SUM();
    await proxy.setProxyWeights([[receiver, proxyWeightBase]]);
    await sender1.setProxy(proxy, proxyWeightBase);
    await sender1.setAmountPerBlock(proxyWeightBase);
    await sender2.setProxy(proxy, proxyWeightBase);
    await sender2.setAmountPerBlock(proxyWeightBase);
    await sender1.topUp(0, proxyWeightBase * 10);
    await sender2.topUp(0, proxyWeightBase * 10);
    await mineBlocks(10);
    await mineBlocksUntilCycleEnd();
    await receiver.collect(proxyWeightBase * 20);
  });

  it("Allows a sender to be updated while sending to a proxy", async function () {
    const [sender, proxy, receiver1, receiver2] = await getEthPoolUsers();
    const proxyWeightBase = await sender.pool.PROXY_WEIGHTS_SUM();
    await proxy.setProxyWeights([[receiver1, proxyWeightBase]]);
    await sender.setProxy(proxy, proxyWeightBase);
    await sender.setAmountPerBlock(proxyWeightBase * 2);
    await sender.topUp(0, proxyWeightBase * 20);
    await mineBlocks(4);
    await sender.setReceiver(receiver2, proxyWeightBase);
    await mineBlocks(4);
    await mineBlocksUntilCycleEnd();
    // 5 blocks of receiving `2 * proxyWeightBase` and 5 of receiving `proxyWeightBase`
    await receiver1.collect(proxyWeightBase * 15);
    // 5 blocks of receiving `proxyWeightBase`
    await receiver2.collect(proxyWeightBase * 5);
  });

  it("Allows updating a part of proxy receivers list", async function () {
    const [
      sender,
      proxy,
      receiver1,
      receiver2,
      receiver3,
      receiver4,
    ] = await getEthPoolUsers();
    const proxyWeightBase = await sender.pool.PROXY_WEIGHTS_SUM();
    await proxy.setProxyWeights([
      [receiver1, proxyWeightBase * 0.5],
      [receiver2, proxyWeightBase * 0.5],
    ]);
    await proxy.setProxyWeights([
      [receiver2, 0],
      [receiver3, proxyWeightBase * 0.25],
      [receiver4, proxyWeightBase * 0.25],
    ]);
    await sender.setProxy(proxy, proxyWeightBase);
    await sender.setAmountPerBlock(proxyWeightBase);
    await sender.topUp(0, proxyWeightBase);
    await mineBlocksUntilCycleEnd();
    await receiver1.collect(proxyWeightBase * 0.5);
    await receiver2.expectCollectable(0);
    await receiver3.collect(proxyWeightBase * 0.25);
    await receiver4.collect(proxyWeightBase * 0.25);
  });

  it("Allows updating proxy in the first cycle of sending", async function () {
    const [
      sender,
      proxy,
      receiver1,
      receiver2,
      receiver3,
      receiver4,
    ] = await getEthPoolUsers();
    const proxyWeightBase = await sender.pool.PROXY_WEIGHTS_SUM();
    await proxy.setProxyWeights([
      [receiver1, proxyWeightBase * 0.5],
      [receiver2, proxyWeightBase * 0.5],
    ]);
    await sender.setProxy(proxy, proxyWeightBase);
    await sender.setAmountPerBlock(proxyWeightBase);
    // Sending spans for two cycles
    await mineBlocksUntilCycleEnd();
    await mineBlocks(CYCLE_BLOCKS / 2);
    await sender.topUp(0, proxyWeightBase * CYCLE_BLOCKS);
    await proxy.setProxyWeights([
      [receiver2, 0],
      [receiver3, proxyWeightBase * 0.25],
      [receiver4, proxyWeightBase * 0.25],
    ]);
    await mineBlocks(CYCLE_BLOCKS - 1);
    await mineBlocksUntilCycleEnd();
    // Receiving 0.5 proxyWeightBase during both cycles
    await receiver1.collect(proxyWeightBase * 0.5 * CYCLE_BLOCKS);
    await receiver2.expectCollectable(0);
    // Receiving 0.25 proxyWeightBase during both cycles
    await receiver3.expectCollectable(proxyWeightBase * 0.25 * CYCLE_BLOCKS);
    // Receiving 0.25 proxyWeightBase during both cycles
    await receiver4.expectCollectable(proxyWeightBase * 0.25 * CYCLE_BLOCKS);
  });

  it("Allows updating proxy in the middle cycle of sending", async function () {
    const [
      sender,
      proxy,
      receiver1,
      receiver2,
      receiver3,
      receiver4,
    ] = await getEthPoolUsers();
    const proxyWeightBase = await sender.pool.PROXY_WEIGHTS_SUM();
    await proxy.setProxyWeights([
      [receiver1, proxyWeightBase * 0.5],
      [receiver2, proxyWeightBase * 0.5],
    ]);
    await sender.setProxy(proxy, proxyWeightBase);
    await sender.setAmountPerBlock(proxyWeightBase);
    // Sending spans for three cycles
    await mineBlocksUntilCycleEnd();
    const thirdCycleBlocks = CYCLE_BLOCKS / 2;
    const firstCycleBlocks = CYCLE_BLOCKS - thirdCycleBlocks;
    await mineBlocks(thirdCycleBlocks);
    await sender.topUp(0, proxyWeightBase * CYCLE_BLOCKS * 2);
    await mineBlocks(CYCLE_BLOCKS - 1);
    await proxy.setProxyWeights([
      [receiver2, 0],
      [receiver3, proxyWeightBase * 0.25],
      [receiver4, proxyWeightBase * 0.25],
    ]);
    await mineBlocks(CYCLE_BLOCKS - 1);
    await mineBlocksUntilCycleEnd();
    // Receiving 0.5 proxyWeightBase during all cycles
    await receiver1.collect(proxyWeightBase * 0.5 * CYCLE_BLOCKS * 2);
    // Receiving 0.5 proxyWeightBase during the first cycle
    await receiver2.collect(proxyWeightBase * 0.5 * firstCycleBlocks);
    // Receiving 0.25 proxyWeightBase during the second and the last cycles
    await receiver3.expectCollectable(
      proxyWeightBase * 0.25 * (CYCLE_BLOCKS + thirdCycleBlocks)
    );
    // Receiving 0.25 proxyWeightBase during the second and the last cycles
    await receiver4.expectCollectable(
      proxyWeightBase * 0.25 * (CYCLE_BLOCKS + thirdCycleBlocks)
    );
  });

  it("Allows updating proxy in the last cycle of sending", async function () {
    const [
      sender,
      proxy,
      receiver1,
      receiver2,
      receiver3,
      receiver4,
    ] = await getEthPoolUsers();
    const proxyWeightBase = await sender.pool.PROXY_WEIGHTS_SUM();
    await proxy.setProxyWeights([
      [receiver1, proxyWeightBase * 0.5],
      [receiver2, proxyWeightBase * 0.5],
    ]);
    await sender.setProxy(proxy, proxyWeightBase);
    await sender.setAmountPerBlock(proxyWeightBase);
    // Sending spans for two cycles
    await mineBlocksUntilCycleEnd();
    const secondCycleBlocks = CYCLE_BLOCKS / 2;
    const firstCycleBlocks = CYCLE_BLOCKS - secondCycleBlocks;
    await mineBlocks(secondCycleBlocks);
    await sender.topUp(0, proxyWeightBase * CYCLE_BLOCKS);
    await mineBlocks(CYCLE_BLOCKS - 1);
    await proxy.setProxyWeights([
      [receiver2, 0],
      [receiver3, proxyWeightBase * 0.25],
      [receiver4, proxyWeightBase * 0.25],
    ]);
    await mineBlocksUntilCycleEnd();
    // Receiving 0.5 proxyWeightBase during both cycles
    await receiver1.collect(proxyWeightBase * 0.5 * CYCLE_BLOCKS);
    // Receiving 0.5 proxyWeightBase during the first cycle
    await receiver2.collect(proxyWeightBase * 0.5 * firstCycleBlocks);
    // Receiving 0.25 proxyWeightBase during the second cycle
    await receiver3.expectCollectable(
      proxyWeightBase * 0.25 * secondCycleBlocks
    );
    // Receiving 0.25 proxyWeightBase during the second cycle
    await receiver4.expectCollectable(
      proxyWeightBase * 0.25 * secondCycleBlocks
    );
  });

  it("Allows updating proxy in the cycle right after sending finishes", async function () {
    const [
      sender,
      proxy,
      receiver1,
      receiver2,
      receiver3,
      receiver4,
    ] = await getEthPoolUsers();
    const proxyWeightBase = await sender.pool.PROXY_WEIGHTS_SUM();
    await proxy.setProxyWeights([
      [receiver1, proxyWeightBase * 0.5],
      [receiver2, proxyWeightBase * 0.5],
    ]);
    await sender.setProxy(proxy, proxyWeightBase);
    await sender.setAmountPerBlock(proxyWeightBase);
    await mineBlocksUntilCycleEnd();
    await sender.topUp(0, proxyWeightBase);
    await mineBlocksUntilCycleEnd();
    await proxy.setProxyWeights([
      [receiver2, 0],
      [receiver3, proxyWeightBase * 0.25],
      [receiver4, proxyWeightBase * 0.25],
    ]);
    await receiver1.collect(proxyWeightBase * 0.5);
    await receiver2.collect(proxyWeightBase * 0.5);
    await receiver3.expectCollectable(0);
    await receiver4.expectCollectable(0);
  });

  it("Allows an address to be a sender, a proxy and a receiver independently", async function () {
    const [sender] = await getEthPoolUsers();
    const proxyWeightBase = await sender.pool.PROXY_WEIGHTS_SUM();
    await sender.setProxyWeights([[sender, proxyWeightBase]]);
    await sender.setProxy(sender, proxyWeightBase);
    await sender.setReceiver(sender, proxyWeightBase);
    await sender.setAmountPerBlock(proxyWeightBase * 2);
    await sender.topUp(0, proxyWeightBase * 2);
    await mineBlocksUntilCycleEnd();
    await sender.collect(proxyWeightBase * 2);
  });

  it("Rejects adding a nonexistent proxy", async function () {
    const [sender, proxy] = await getEthPoolUsers();
    await sender.expectSetProxyReverts(proxy, 100, "Proxy doesn't exist");
  });

  it("Rejects adding a proxy weight not being a multiple of proxy weights sum", async function () {
    const [sender, proxy, receiver] = await getEthPoolUsers();
    const proxyWeightBase = await sender.pool.PROXY_WEIGHTS_SUM();
    await proxy.setProxyWeights([[receiver, proxyWeightBase]]);
    await sender.expectSetProxyReverts(
      proxy,
      99,
      "Proxy weight not a multiple of PROXY_WEIGHTS_SUM"
    );
  });

  it("Limits the total proxy receivers weights sum", async function () {
    const [sender, proxy, receiver] = await getEthPoolUsers();
    const weightsSumMax = await sender.pool.SENDER_WEIGHTS_SUM_MAX();
    const proxyWeightBase = await sender.pool.PROXY_WEIGHTS_SUM();
    await proxy.setProxyWeights([[receiver, proxyWeightBase]]);
    // Total weight too big by 1
    await sender.setReceiver(receiver, weightsSumMax - proxyWeightBase + 1);
    await sender.expectSetProxyReverts(
      proxy,
      proxyWeightBase,
      "Too much total receivers weight"
    );
    // Total weight maxed out
    await sender.setReceiver(receiver, weightsSumMax - proxyWeightBase);
    await sender.setProxy(proxy, proxyWeightBase);
  });

  it("Limits the overflowing total proxy receivers weights sum", async function () {
    const [sender, proxy, receiver] = await getEthPoolUsers();
    const proxyWeightBase = await sender.pool.PROXY_WEIGHTS_SUM();
    await proxy.setProxyWeights([[receiver, proxyWeightBase]]);
    const targetTotalWeight = 2 ** 32;
    const proxyWeight =
      targetTotalWeight - (targetTotalWeight % proxyWeightBase);
    await sender.setReceiver(receiver, targetTotalWeight - proxyWeight);
    await sender.expectSetProxyReverts(
      proxy,
      proxyWeight,
      "Too much total receivers weight"
    );
  });

  it("Limits the total proxy receivers count", async function () {
    const [sender, proxy, receiver] = await getEthPoolUsers();
    const weightsCountMax = await sender.pool.SENDER_WEIGHTS_COUNT_MAX();
    const proxyWeightBase = await sender.pool.PROXY_WEIGHTS_SUM();
    const proxyCountBase = await sender.pool.PROXY_WEIGHTS_COUNT_MAX();
    await proxy.setProxyWeights([[receiver, proxyWeightBase]]);
    for (let i = 0; i < weightsCountMax - proxyCountBase; i++) {
      // This is much faster than using the `setReceiver()` test utility
      await sender.pool.setReceiver(randomAddress(), 1);
    }
    // Total weight too big by 1
    await sender.setReceiver(receiver, 1);
    await sender.expectSetProxyReverts(
      proxy,
      proxyWeightBase,
      "Too many receivers"
    );
    // Total count maxed out
    await sender.setReceiver(receiver, 0);
    await sender.setProxy(proxy, proxyWeightBase);
  });

  it("Rejects creation of a proxy with an invalid weights sum", async function () {
    const [proxy, receiver] = await getEthPoolUsers();
    const proxyWeightSum = await proxy.pool.PROXY_WEIGHTS_SUM();
    await proxy.expectSetProxyWeightsReverts(
      [[receiver, proxyWeightSum + 1]],
      "Proxy doesn't have the constant weight sum"
    );
  });

  it("Rejects update of a proxy with an invalid weights sum", async function () {
    const [proxy, receiver] = await getEthPoolUsers();
    const proxyWeightSum = await proxy.pool.PROXY_WEIGHTS_SUM();
    await proxy.setProxyWeights([[receiver, proxyWeightSum]]);
    await proxy.expectSetProxyWeightsReverts(
      [[receiver, proxyWeightSum + 1]],
      "Proxy doesn't have the constant weight sum"
    );
  });

  it("Rejects creation of a proxy could overflow the weights sum", async function () {
    const [proxy, receiver1, receiver2] = await getEthPoolUsers();
    const proxyWeightSum = await proxy.pool.PROXY_WEIGHTS_SUM();
    await proxy.expectSetProxyWeightsReverts(
      [
        [receiver1, proxyWeightSum + 1],
        [receiver2, 2 ** 32 - 1],
      ],
      "Proxy doesn't have the constant weight sum"
    );
  });

  it("Rejects update of a proxy with too many receivers", async function () {
    const [proxy, ...receivers] = await getEthPoolUsers();
    const proxyWeightSum = await proxy.pool.PROXY_WEIGHTS_SUM();
    const proxyWeightCountMax = await proxy.pool.PROXY_WEIGHTS_COUNT_MAX();
    const weights: [EthPoolUser, number][] = [
      [receivers[0], proxyWeightSum - proxyWeightCountMax + 1],
    ];
    for (let i = 1; i < proxyWeightCountMax; i++) {
      weights.push([receivers[i], 1]);
    }
    await proxy.setProxyWeights(weights);
    await proxy.expectSetProxyWeightsReverts(
      [
        [receivers[0], proxyWeightSum - proxyWeightCountMax],
        [receivers[proxyWeightCountMax], 1],
      ],
      "Too many proxy receivers"
    );
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
      sender.pool.withdraw(withdrawAll, { gasPrice: 0 }),
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
