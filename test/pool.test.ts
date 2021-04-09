import {
  Erc20Pool__factory,
  EthPool__factory,
  RadicleToken__factory,
} from "../contract-bindings/ethers";
import { IERC20 } from "../contract-bindings/ethers/IERC20";
import { Erc20Pool } from "../contract-bindings/ethers/Erc20Pool";
import { EthPool } from "../contract-bindings/ethers/EthPool";
import { ethers } from "hardhat";
import { Signer, BigNumber, BigNumberish, ContractReceipt, ContractTransaction } from "ethers";
import { expect } from "chai";
import {
  callOnNextBlock,
  elapseTime,
  elapseTimeUntil,
  expectBigNumberEq,
  randomAddress,
  submit,
  submitFailing,
} from "./support";

const CYCLE_SECS = 10;

// Elapses time until the next cycle is reached, at least 1 second.
// The next transaction will be executed on the first second of the next cycle,
// but the next call will be executed on the last second of the current cycle.
async function elapseTimeUntilCycleEnd(): Promise<void> {
  const latestBlock = await ethers.provider.getBlock("latest");
  await elapseTimeUntil(Math.ceil((latestBlock.timestamp + 2) / CYCLE_SECS) * CYCLE_SECS - 1);
}

type AnyPool = EthPool | Erc20Pool;

type ReceiverWeights = [PoolUser<AnyPool>, number][];
type ReceiverWeightsAddr = Array<{
  receiver: string;
  weight: number;
}>;

function receiverWeightsAddr(weights: ReceiverWeights): ReceiverWeightsAddr {
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
  weights: ProxyReceiverWeights,
  receiver: string,
  receiverWeight?: number,
  proxyWeight?: number
): void {
  const weight = weights.get(receiver) || ProxyReceiverWeight.empty();
  if (receiverWeight !== undefined) weight.receiverWeight = receiverWeight;
  if (proxyWeight !== undefined) weight.proxyWeight = proxyWeight;
  if (weight.isEmpty()) {
    weights.delete(receiver);
  } else {
    weights.set(receiver, weight);
  }
}

interface PoolConstants {
  senderWeightsSumMax: number;
  senderWeightsCountMax: number;
  proxyWeightsSum: number;
  proxyWeightsCountMax: number;
  withdrawAll: BigNumber;
  amtPerSecUnchanged: BigNumber;
}

async function poolConstants(pool: AnyPool): Promise<PoolConstants> {
  return {
    senderWeightsSumMax: await pool.SENDER_WEIGHTS_SUM_MAX(),
    senderWeightsCountMax: await pool.SENDER_WEIGHTS_COUNT_MAX(),
    proxyWeightsSum: await pool.PROXY_WEIGHTS_SUM(),
    proxyWeightsCountMax: await pool.PROXY_WEIGHTS_COUNT_MAX(),
    withdrawAll: await pool.WITHDRAW_ALL(),
    amtPerSecUnchanged: await pool.AMT_PER_SEC_UNCHANGED(),
  };
}

abstract class PoolUser<Pool extends AnyPool> {
  pool: Pool;
  // The address of the user
  addr: string;
  senderWeightsSumMax: number;
  senderWeightsCountMax: number;
  proxyWeightsSum: number;
  proxyWeightsCountMax: number;
  withdrawAll: BigNumber;
  amtPerSecUnchanged: BigNumber;
  maxTimestamp: BigNumber;

  constructor(pool: Pool, userAddr: string, constants: PoolConstants) {
    this.pool = pool;
    this.addr = userAddr;
    this.senderWeightsSumMax = constants.senderWeightsSumMax;
    this.senderWeightsCountMax = constants.senderWeightsCountMax;
    this.proxyWeightsSum = constants.proxyWeightsSum;
    this.proxyWeightsCountMax = constants.proxyWeightsCountMax;
    this.withdrawAll = constants.withdrawAll;
    this.amtPerSecUnchanged = constants.amtPerSecUnchanged;
    // Same as Pool contract `MAX_TIMESTAMP`
    this.maxTimestamp = BigNumber.from(1).shl(64).sub(3);
  }

  abstract getBalance(): Promise<BigNumber>;

  abstract submitUpdateSender(
    topUp: BigNumberish,
    withdraw: BigNumberish,
    amtPerSec: BigNumberish,
    setReceivers: ReceiverWeightsAddr,
    setProxies: ReceiverWeightsAddr
  ): Promise<ContractTransaction>;

  async collect(expectedAmount: number): Promise<void> {
    await this.expectCollectableOnNextBlock(expectedAmount);
    await this.submitChangingBalance(
      () => this.pool.collect({ gasPrice: 0 }),
      "collect",
      expectedAmount
    );
    await this.expectCollectable(0);
  }

  async updateSender(
    balanceFrom: BigNumberish,
    balanceTo: BigNumberish,
    amtPerSec: BigNumberish,
    setReceivers: ReceiverWeights,
    setProxies: ReceiverWeights
  ): Promise<void> {
    const balanceDelta = BigNumber.from(balanceFrom).sub(balanceTo);
    const topUp = balanceDelta.lt(0) ? balanceDelta.abs() : 0;
    const withdraw = balanceDelta.gt(0) ? balanceDelta : 0;
    const expectedAmtPerSec = await this.expectedAmtPerSec(amtPerSec);
    const receiversAddr = receiverWeightsAddr(setReceivers);
    const proxiesAddr = receiverWeightsAddr(setProxies);
    const expectedReceivers = await this.expectedReceivers(receiversAddr, proxiesAddr);
    const oldActiveReceivers = await this.getActiveReceivers();
    await this.expectWithdrawableOnNextBlock(balanceFrom);

    const receipt = await this.submitChangingBalance(
      () => this.submitUpdateSender(topUp, withdraw, amtPerSec, receiversAddr, proxiesAddr),
      "updateSender",
      balanceDelta
    );

    await this.expectWithdrawable(balanceTo);
    await this.expectAmtPerSec(expectedAmtPerSec);
    await this.expectReceivers(expectedReceivers);
    await this.expectUpdateSenderEvents(oldActiveReceivers, receipt);
  }

  async updateSenderBalanceUnchanged(
    amtPerSec: BigNumberish,
    setReceivers: ReceiverWeights,
    setProxies: ReceiverWeights
  ): Promise<void> {
    const balance = await callOnNextBlock(() => this.pool.withdrawable());
    await this.updateSender(balance, balance, amtPerSec, setReceivers, setProxies);
  }

  async expectUpdateSenderBalanceUnchangedReverts(
    amtPerSec: BigNumberish,
    setReceivers: ReceiverWeights,
    setProxies: ReceiverWeights,
    expectedCause: string
  ): Promise<void> {
    await submitFailing(
      this.submitUpdateSender(
        0,
        0,
        amtPerSec,
        receiverWeightsAddr(setReceivers),
        receiverWeightsAddr(setProxies)
      ),
      "updateSender",
      expectedCause
    );
  }

  async topUp(balanceFrom: BigNumberish, balanceTo: BigNumberish): Promise<void> {
    await this.updateSender(balanceFrom, balanceTo, this.amtPerSecUnchanged, [], []);
  }

  async withdraw(balanceFrom: BigNumberish, balanceTo: BigNumberish): Promise<void> {
    await this.updateSender(balanceFrom, balanceTo, this.amtPerSecUnchanged, [], []);
  }

  async submitChangingBalance(
    fn: () => Promise<ContractTransaction>,
    txName: string,
    balanceChangeExpected: BigNumberish
  ): Promise<ContractReceipt> {
    const balanceBefore = await this.getBalance();
    const receipt = await submit(fn(), txName);
    const balanceAfter = await this.getBalance();
    const balanceChangeActual = balanceAfter.sub(balanceBefore);
    expectBigNumberEq(
      balanceChangeActual,
      balanceChangeExpected,
      "Unexpected balance change from call to " + txName
    );
    return receipt;
  }

  async setAmtPerSec(amount: BigNumberish): Promise<void> {
    await this.updateSenderBalanceUnchanged(amount, [], []);
  }

  async getAmtPerSec(): Promise<number> {
    return (await this.pool.getAmtPerSec()).toNumber();
  }

  async setReceivers(receivers: ReceiverWeights, proxies: ReceiverWeights): Promise<void> {
    await this.updateSenderBalanceUnchanged(this.amtPerSecUnchanged, receivers, proxies);
  }

  async setReceiver(receiver: this, weight: number): Promise<void> {
    await this.updateSenderBalanceUnchanged(this.amtPerSecUnchanged, [[receiver, weight]], []);
  }

  async getActiveReceivers(): Promise<ProxyReceiverWeights> {
    const allReceivers = await this.getAllReceivers();
    const amtPerSec = await this.getAmtPerSec();
    let weightsSum = 0;
    for (const [, weights] of allReceivers) {
      weightsSum += weights.receiverWeight + weights.proxyWeight;
    }
    const withdrawable = await this.pool.withdrawable();
    const areActive = amtPerSec >= weightsSum && withdrawable.gte(amtPerSec);
    return areActive ? allReceivers : new Map();
  }

  async expectSetReceiverReverts(
    receiver: this,
    weight: number,
    expectedCause: string
  ): Promise<void> {
    await this.expectUpdateSenderBalanceUnchangedReverts(
      this.amtPerSecUnchanged,
      [[receiver, weight]],
      [],
      expectedCause
    );
  }

  async setProxy(receiver: this, weight: number): Promise<void> {
    await this.updateSenderBalanceUnchanged(this.amtPerSecUnchanged, [], [[receiver, weight]]);
  }

  async expectSetProxyReverts(
    receiver: this,
    weight: number,
    expectedCause: string
  ): Promise<void> {
    await this.expectUpdateSenderBalanceUnchangedReverts(
      this.amtPerSecUnchanged,
      [],
      [[receiver, weight]],
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
    const weightsAddr = receiverWeightsAddr(weights);
    for (const { receiver, weight } of weightsAddr) {
      if (weight == 0) {
        expectedWeights.delete(receiver);
      } else {
        expectedWeights.set(receiver, weight);
      }
    }
    const receipt = await submit(this.pool.setProxyWeights(weightsAddr), "setProxyWeights");
    await this.expectProxyWeights(expectedWeights);

    // Assert that proper events have been emitted
    const filter = this.pool.filters.ProxyToReceiverUpdated(null, null, null);
    const events = await this.pool.queryFilter(filter, receipt.blockHash);
    for (const { receiver, weight } of weightsAddr) {
      const errorPrefix = "Proxy update event for receiver " + receiver + " ";
      const idx = events.findIndex((event) => event.args.receiver == receiver);
      expect(idx).to.be.not.equal(-1, errorPrefix + "not found");
      const [event] = events.splice(idx, 1);
      expect(event.args.proxy).to.equal(this.addr, errorPrefix + "has invalid proxy");
      expect(event.args.weight).to.equal(weight, errorPrefix + "has invalid receiver");
    }
    expect(events, "Excess proxy update events").to.be.empty;
  }

  async expectSetProxyWeightsReverts(
    weights: ReceiverWeights,
    expectedCause: string
  ): Promise<void> {
    const weightsAddr = receiverWeightsAddr(weights);
    await submitFailing(this.pool.setProxyWeights(weightsAddr), "setProxyWeights", expectedCause);
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

  async expectWithdrawableOnNextBlock(amount: BigNumberish): Promise<void> {
    await callOnNextBlock(async () => {
      await this.expectWithdrawable(amount);
    });
  }

  async expectWithdrawable(amount: BigNumberish): Promise<void> {
    const withdrawable = await this.pool.withdrawable();
    expectBigNumberEq(withdrawable, amount, "The withdrawable amount is invalid");
  }

  // The expected amount per second after updating it with the given value
  async expectedAmtPerSec(setAmt: BigNumberish): Promise<number> {
    if (this.amtPerSecUnchanged.eq(setAmt)) {
      return await this.getAmtPerSec();
    } else {
      return BigNumber.from(setAmt).toNumber();
    }
  }

  async expectAmtPerSec(amount: number): Promise<void> {
    const actualAmount = await this.getAmtPerSec();
    expect(actualAmount).to.equal(
      amount,
      "The amount per second is different from the expected amount"
    );
  }

  // The expected amount per second after updating it with the given values
  async expectedReceivers(
    receivers: ReceiverWeightsAddr,
    proxies: ReceiverWeightsAddr
  ): Promise<ProxyReceiverWeights> {
    const allReceivers = await this.getAllReceivers();
    receivers.forEach(({ receiver, weight }) =>
      updateReceiverWeights(allReceivers, receiver, weight, undefined)
    );
    proxies.forEach(({ receiver, weight }) =>
      updateReceiverWeights(allReceivers, receiver, undefined, weight)
    );
    return allReceivers;
  }

  async expectReceivers(receivers: ProxyReceiverWeights): Promise<void> {
    const receiversActual = await this.getAllReceivers();
    expect(receiversActual).to.deep.equal(receivers, "Unexpected receivers list");
  }

  async expectProxyWeights(weights: Map<string, number>): Promise<void> {
    const weightsActual = await this.getProxyWeights();
    expect(weightsActual).to.deep.equal(weights, "Unexpected proxy weights list");
  }

  // Check if the sender update generated proper events.
  // `oldActiveReceivers` - the receivers of `this` sender, which were
  // receiving anything at the time of the update
  async expectUpdateSenderEvents(
    oldActiveReceivers: ProxyReceiverWeights,
    receipt: ContractReceipt
  ): Promise<void> {
    const receiverFilter = this.pool.filters.SenderToReceiverUpdated(null, null, null, null);
    const receiverEvents = await this.pool.queryFilter(receiverFilter, receipt.blockHash);
    const proxyFilter = this.pool.filters.SenderToProxyUpdated(null, null, null, null);
    const proxyEvents = await this.pool.queryFilter(proxyFilter, receipt.blockHash);

    // Assert that all receiver stop sending events are before start sending events
    let foundReceiverStartSending = false;
    for (const event of receiverEvents) {
      const isStartSending = !event.args.amtPerSec.isZero();
      if (foundReceiverStartSending) {
        expect(
          isStartSending,
          "A stop sending to a receiver event found after a start sending event"
        ).to.be.true;
      }
      foundReceiverStartSending = isStartSending;
    }

    // Assert that all proxy stop sending events are before start sending events
    let foundProxyStartSending = false;
    for (const event of proxyEvents) {
      const isStartSending = !event.args.amtPerSec.isZero();
      if (foundProxyStartSending) {
        expect(isStartSending, "A stop sending to a proxy event found after a start sending event")
          .to.be.true;
      }
      foundProxyStartSending = isStartSending;
    }

    // Assert that all old receivers who have been getting funds have stop sending events
    const sender = receipt.from;
    const blockTime = (await this.pool.provider.getBlock(receipt.blockHash)).timestamp;
    for (const [receiver, { receiverWeight, proxyWeight }] of oldActiveReceivers) {
      if (receiverWeight != 0) {
        const errorPrefix = "Stop sending event for receiver " + receiver + " ";
        const idx = receiverEvents.findIndex((event) => event.args.receiver == receiver);
        expect(idx).to.be.not.equal(-1, errorPrefix + "not found");
        const [event] = receiverEvents.splice(idx, 1);
        expect(event.args.sender).to.equal(sender, errorPrefix + "has invalid sender");
        expectBigNumberEq(event.args.amtPerSec, 0, errorPrefix + "has invalid amtPerSec");
        expectBigNumberEq(event.args.endTime, blockTime, errorPrefix + "has invalid end time");
      }
      if (proxyWeight != 0) {
        const errorPrefix = "Stop sending event for proxy " + receiver + " ";
        const idx = proxyEvents.findIndex((event) => event.args.proxy == receiver);
        expect(idx).to.be.not.equal(-1, errorPrefix + "not found");
        const [event] = proxyEvents.splice(idx, 1);
        expect(event.args.sender).to.equal(sender, errorPrefix + "has invalid sender");
        expectBigNumberEq(event.args.amtPerSec, 0, errorPrefix + "has invalid amtPerSec");
        expectBigNumberEq(event.args.endTime, blockTime, errorPrefix + "has invalid end time");
      }
    }

    // Assert that all current receivers who are getting funds have start sending events
    const activeReceivers = await this.getActiveReceivers();
    let weightsSum = 0;
    for (const [, weights] of activeReceivers) {
      weightsSum += weights.receiverWeight + weights.proxyWeight;
    }
    const amtPerSecPerWeight = Math.floor((await this.getAmtPerSec()) / weightsSum);
    const amtPerSec = amtPerSecPerWeight * weightsSum;
    const timeLeft = Number.isInteger(amtPerSec)
      ? (await this.pool.withdrawable()).div(amtPerSec)
      : BigNumber.from(0);
    let endTime = timeLeft.add(blockTime);
    endTime = endTime.gt(this.maxTimestamp) ? this.maxTimestamp : endTime;
    for (const [receiver, { receiverWeight, proxyWeight }] of activeReceivers) {
      if (receiverWeight != 0) {
        const errorPrefix = "Start sending event for receiver " + receiver + " ";
        const idx = receiverEvents.findIndex((event) => event.args.receiver == receiver);
        expect(idx).to.be.not.equal(-1, errorPrefix + "not found");
        const [event] = receiverEvents.splice(idx, 1);
        expect(event.args.sender).to.equal(sender, errorPrefix + "has invalid sender");
        const amtPerSec = amtPerSecPerWeight * receiverWeight;
        expectBigNumberEq(event.args.amtPerSec, amtPerSec, errorPrefix + "has invalid amtPerSec");
        expectBigNumberEq(event.args.endTime, endTime, errorPrefix + "has invalid end time");
      }
      if (proxyWeight != 0) {
        const errorPrefix = "Start sending event for proxy " + receiver + " ";
        const idx = proxyEvents.findIndex((event) => event.args.proxy == receiver);
        expect(idx).to.be.not.equal(-1, errorPrefix + "not found");
        const [event] = proxyEvents.splice(idx, 1);
        expect(event.args.sender).to.equal(sender, errorPrefix + "has invalid sender");
        const amtPerSec = amtPerSecPerWeight * proxyWeight;
        expectBigNumberEq(event.args.amtPerSec, amtPerSec, errorPrefix + "has invalid amtPerSec");
        expectBigNumberEq(event.args.endTime, endTime, errorPrefix + "has invalid end time");
      }
    }

    expect(receiverEvents, "Excess sending to a receiver update events").to.be.empty;
    expect(proxyEvents, "Excess sending to a proxy update events").to.be.empty;
  }
}

async function getEthPoolUsers(): Promise<EthPoolUser[]> {
  const signers = await ethers.getSigners();
  const pool = await new EthPool__factory(signers[0]).deploy(CYCLE_SECS);
  await pool.deployed();
  const constants = await poolConstants(pool);
  const poolSigners = signers.map(
    async (signer: Signer) => await EthPoolUser.new(pool, signer, constants)
  );
  return Promise.all(poolSigners);
}

class EthPoolUser extends PoolUser<EthPool> {
  constructor(pool: EthPool, userAddr: string, constants: PoolConstants) {
    super(pool, userAddr, constants);
  }

  static async new(pool: EthPool, signer: Signer, constants: PoolConstants): Promise<EthPoolUser> {
    const userPool = pool.connect(signer);
    const userAddr = await signer.getAddress();
    return new EthPoolUser(userPool, userAddr, constants);
  }

  async getBalance(): Promise<BigNumber> {
    return await this.pool.signer.getBalance();
  }

  submitUpdateSender(
    topUp: BigNumberish,
    withdraw: BigNumberish,
    amtPerSec: BigNumberish,
    setReceivers: ReceiverWeightsAddr,
    setProxies: ReceiverWeightsAddr
  ): Promise<ContractTransaction> {
    return this.pool.updateSender(withdraw, amtPerSec, setReceivers, setProxies, {
      value: topUp,
      gasPrice: 0,
    });
  }
}

async function getErc20PoolUsers(): Promise<Erc20PoolUser[]> {
  const signers = await ethers.getSigners();
  const signer0 = signers[0];
  const signer0Addr = await signer0.getAddress();

  const erc20 = await new RadicleToken__factory(signer0).deploy(signer0Addr);
  await erc20.deployed();

  const pool = await new Erc20Pool__factory(signer0).deploy(CYCLE_SECS, erc20.address);
  await pool.deployed();
  const constants = await poolConstants(pool);

  const supplyPerUser = (await erc20.totalSupply()).div(signers.length);
  const approveAll = BigNumber.from(1).shl(256).sub(1);
  const users = [];
  for (const signer of signers) {
    const user = await Erc20PoolUser.new(pool, erc20, signer, constants);
    await erc20.transfer(user.addr, supplyPerUser);
    await user.erc20.approve(pool.address, approveAll);
    users.push(user);
  }
  return users;
}

class Erc20PoolUser extends PoolUser<Erc20Pool> {
  erc20: IERC20;

  constructor(pool: Erc20Pool, userAddr: string, constants: PoolConstants, erc20: IERC20) {
    super(pool, userAddr, constants);
    this.erc20 = erc20;
  }

  static async new(
    pool: Erc20Pool,
    erc20: IERC20,
    signer: Signer,
    constants: PoolConstants
  ): Promise<Erc20PoolUser> {
    const userPool = pool.connect(signer);
    const userAddr = await signer.getAddress();
    const userErc20 = erc20.connect(signer);
    return new Erc20PoolUser(userPool, userAddr, constants, userErc20);
  }

  async getBalance(): Promise<BigNumber> {
    return await this.erc20.balanceOf(this.addr);
  }

  submitUpdateSender(
    topUp: BigNumberish,
    withdraw: BigNumberish,
    amtPerSec: BigNumberish,
    setReceivers: ReceiverWeightsAddr,
    setProxies: ReceiverWeightsAddr
  ): Promise<ContractTransaction> {
    return this.pool.updateSender(topUp, withdraw, amtPerSec, setReceivers, setProxies);
  }
}

describe("EthPool", function () {
  runCommonPoolTests(getEthPoolUsers);

  it("Sends funds from a single sender to a single receiver", async function () {
    const [sender, receiver] = await getEthPoolUsers();
    await sender.updateSender(0, 100, 1, [[receiver, 1]], []);
    await elapseTime(15);
    // Sender had 16 seconds paying 1 per second
    await sender.withdraw(84, 0);
    await elapseTimeUntilCycleEnd();
    // Sender had 16 seconds paying 1 per second
    await receiver.collect(16);
  });

  it("Sends some funds from a single sender to two receivers", async function () {
    const [sender, receiver1, receiver2] = await getEthPoolUsers();
    await sender.updateSender(
      0,
      100,
      2,
      [
        [receiver1, 1],
        [receiver2, 1],
      ],
      []
    );
    await elapseTime(13);
    // Sender had 14 seconds paying 2 per second
    await sender.withdraw(72, 0);
    await elapseTimeUntilCycleEnd();
    // Receiver 1 had 14 seconds paying 1 per second
    await receiver1.collect(14);
    // Receiver 2 had 14 seconds paying 1 per second
    await receiver2.collect(14);
  });

  it("Sends some funds from a two senders to a single receiver", async function () {
    const [sender1, sender2, receiver] = await getEthPoolUsers();
    await sender1.updateSender(0, 100, 1, [[receiver, 1]], []);
    await sender2.updateSender(0, 100, 2, [[receiver, 1]], []);
    await elapseTime(14);
    // Sender2 had 15 seconds paying 2 per second
    await sender2.withdraw(70, 0);
    // Sender1 had 17 seconds paying 1 per second
    await sender1.withdraw(83, 0);
    await elapseTimeUntilCycleEnd();
    // Receiver had 15 seconds paying 3 per second and 2 seconds paying 1 per second
    await receiver.collect(47);
  });

  it("Does not require receiver to be initialized", async function () {
    const [receiver] = await getEthPoolUsers();
    await receiver.collect(0);
  });

  it("Allows collecting funds while they are being sent", async function () {
    const [sender, receiver] = await getEthPoolUsers();
    await sender.updateSender(0, CYCLE_SECS + 10, 1, [], []);
    await elapseTimeUntilCycleEnd();
    await sender.setReceiver(receiver, 1);
    await elapseTimeUntilCycleEnd();
    // Receiver had CYCLE_SECS seconds paying 1 per second
    await receiver.collect(CYCLE_SECS);
    await elapseTime(6);
    // Sender had CYCLE_SECS + 7 seconds paying 1 per second
    await sender.withdraw(3, 0);
    await elapseTimeUntilCycleEnd();
    // Receiver had 7 seconds paying 1 per second
    await receiver.collect(7);
  });

  it("Sends funds until they run out", async function () {
    const [sender, receiver] = await getEthPoolUsers();
    await sender.updateSender(0, 100, 9, [[receiver, 1]], []);
    await elapseTime(9);
    // Sender had 10 seconds paying 9 per second, funds are about to run out
    await sender.expectWithdrawableOnNextBlock(10);
    // Sender had 11 seconds paying 9 per second, funds have run out
    await elapseTime(1);
    await sender.expectWithdrawableOnNextBlock(1);
    // Nothing more will be sent
    await elapseTimeUntilCycleEnd();
    await receiver.collect(99);
    await sender.withdraw(1, 0);
  });

  it("Allows topping up while sending", async function () {
    const [sender, receiver] = await getEthPoolUsers();
    await sender.updateSender(0, 100, 10, [[receiver, 1]], []);
    await elapseTime(5);
    // Sender had 6 seconds paying 10 per second
    await sender.topUp(40, 60);
    await elapseTime(4);
    // Sender had 5 seconds paying 10 per second
    await sender.withdraw(10, 0);
    await elapseTimeUntilCycleEnd();
    // Receiver had 11 seconds paying 10 per second
    await receiver.collect(110);
  });

  it("Allows topping up after funds run out", async function () {
    const [sender, receiver] = await getEthPoolUsers();
    await sender.updateSender(0, 100, 10, [[receiver, 1]], []);
    await elapseTime(20);
    // Sender had 10 seconds paying 10 per second
    await sender.expectWithdrawable(0);
    await elapseTimeUntilCycleEnd();
    // Receiver had 10 seconds paying 10 per second
    await receiver.expectCollectableOnNextBlock(100);
    await sender.topUp(0, 60);
    await elapseTime(4);
    // Sender had 5 seconds paying 10 per second
    await sender.withdraw(10, 0);
    await elapseTimeUntilCycleEnd();
    // Receiver had 15 seconds paying 10 per second
    await receiver.collect(150);
  });

  it("Allows not changing amount per second", async function () {
    const [sender] = await getEthPoolUsers();
    await sender.setAmtPerSec(10);
    await sender.setAmtPerSec(sender.amtPerSecUnchanged);
  });

  it("Allows sending, which should end after timestamp 2^64", async function () {
    const [sender, receiver] = await getEthPoolUsers();
    const toppedUp = BigNumber.from(2).pow(64).add(5);
    await sender.updateSender(0, toppedUp, 1, [[receiver, 1]], []);
    await elapseTime(9);
    // Sender had 10 seconds paying 1 per second
    await sender.withdraw(toppedUp.sub(10), 0);
    await elapseTimeUntilCycleEnd();
    // Receiver had 10 seconds paying 1 per second
    await receiver.collect(10);
  });

  it("Allows changing amount per second while sending", async function () {
    const [sender, receiver] = await getEthPoolUsers();
    await sender.updateSender(0, 100, 10, [[receiver, 1]], []);
    await elapseTime(3);
    await sender.setAmtPerSec(9);
    await elapseTime(3);
    // Sender had 4 seconds paying 10 per second and 4 seconds paying 9 per second
    await sender.withdraw(24, 0);
    await elapseTimeUntilCycleEnd();
    // Receiver had 4 seconds paying 10 per second and 4 seconds paying 9 per second
    await receiver.collect(76);
  });

  it("Sends amount per second rounded down to a multiple of weights sum", async function () {
    const [sender, receiver] = await getEthPoolUsers();
    await sender.updateSender(0, 100, 9, [[receiver, 5]], []);
    await elapseTime(4);
    // Sender had 5 seconds paying 5 per second
    await sender.withdraw(75, 0);
    await elapseTimeUntilCycleEnd();
    // Receiver had 5 seconds paying 5 per second
    await receiver.collect(25);
  });

  it("Sends nothing if amount per second is smaller than weights sum", async function () {
    const [sender, receiver] = await getEthPoolUsers();
    await sender.updateSender(0, 100, 4, [[receiver, 5]], []);
    await elapseTime(4);
    // Sender had no paying seconds
    await sender.withdraw(100, 0);
    await elapseTimeUntilCycleEnd();
    // Receiver had no paying seconds
    await receiver.collect(0);
  });

  it("Allows removing the last receiver weight when amount per second is zero", async function () {
    const [sender, receiver1, receiver2] = await getEthPoolUsers();
    await sender.updateSender(
      0,
      100,
      12,
      [
        [receiver1, 1],
        [receiver2, 1],
        [receiver2, 0],
      ],
      []
    );
    // Sender had 1 seconds paying 12 per second
    await sender.withdraw(88, 0);
    await elapseTimeUntilCycleEnd();
    // Receiver1 had 1 seconds paying 12 per second
    await receiver1.collect(12);
    // Receiver2 had 0 paying seconds
    await receiver2.expectCollectable(0);
  });

  it("Allows changing receiver weights while sending", async function () {
    const [sender, receiver1, receiver2] = await getEthPoolUsers();
    await sender.updateSender(
      0,
      100,
      12,
      [
        [receiver1, 1],
        [receiver2, 1],
      ],
      []
    );
    await elapseTime(2);
    await sender.setReceiver(receiver2, 2);
    await elapseTime(3);
    // Sender had 7 seconds paying 12 per second
    await sender.withdraw(16, 0);
    await elapseTimeUntilCycleEnd();
    // Receiver1 had 3 seconds paying 6 per second and 4 seconds paying 4 per second
    await receiver1.collect(34);
    // Receiver2 had 3 seconds paying 6 per second and 4 seconds paying 8 per second
    await receiver2.collect(50);
  });

  it("Allows removing receivers while sending", async function () {
    const [sender, receiver1, receiver2] = await getEthPoolUsers();
    await sender.updateSender(
      0,
      100,
      10,
      [
        [receiver1, 1],
        [receiver2, 1],
      ],
      []
    );
    await elapseTime(2);
    await sender.setReceiver(receiver1, 0);
    await elapseTime(3);
    await sender.setReceiver(receiver2, 0);
    await elapseTime(10);
    // Sender had 7 seconds paying 10 per second
    await sender.withdraw(30, 0);
    await elapseTimeUntilCycleEnd();
    // Receiver1 had 3 seconds paying 5 per second
    await receiver1.collect(15);
    // Receiver2 had 3 seconds paying 5 per second and 4 seconds paying 10 per second
    await receiver2.collect(55);
  });

  it("Limits the total weights sum", async function () {
    const [sender, receiver1, receiver2] = await getEthPoolUsers();
    await sender.setReceiver(receiver1, sender.senderWeightsSumMax);
    await sender.expectSetReceiverReverts(receiver2, 1, "Too much total receivers weight");
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
    const receivers = new Array(sender.senderWeightsCountMax)
      .fill(0)
      .map(() => ({ receiver: randomAddress(), weight: 1 }));
    await submit(
      sender.submitUpdateSender(0, 0, sender.amtPerSecUnchanged, receivers, []),
      "updateSender"
    );
    await sender.expectSetReceiverReverts(receiver, 1, "Too many receivers");
  });

  it("Allows batch setting multiple receivers and proxies", async function () {
    const [sender, receiver1, receiver2, receiver3, proxy1, proxy2] = await getEthPoolUsers();
    const proxyWeightBase = sender.proxyWeightsSum;
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

  it("Allows sending via a proxy", async function () {
    const [sender, proxy, receiver] = await getEthPoolUsers();
    const proxyWeightBase = sender.proxyWeightsSum;
    await proxy.setProxyWeights([[receiver, proxyWeightBase]]);
    await sender.updateSender(
      0,
      proxyWeightBase * 2,
      proxyWeightBase * 2,
      [],
      [[proxy, proxyWeightBase]]
    );
    await elapseTimeUntilCycleEnd();
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
    const proxyWeightBase = sender.proxyWeightsSum;
    await proxy1.setProxyWeights([
      [receiver1, proxyWeightBase * 0.75],
      [receiver2, proxyWeightBase * 0.25],
    ]);
    await proxy2.setProxyWeights([[receiver3, proxyWeightBase]]);
    await sender.updateSender(
      0,
      proxyWeightBase * 8,
      proxyWeightBase * 4,
      [[receiver4, proxyWeightBase]],
      [
        [proxy1, proxyWeightBase],
        [proxy2, proxyWeightBase * 2],
      ]
    );
    await elapseTimeUntilCycleEnd();
    await receiver1.collect(proxyWeightBase * 1.5);
    await receiver2.collect(proxyWeightBase * 0.5);
    await receiver3.collect(proxyWeightBase * 4);
    await receiver4.collect(proxyWeightBase * 2);
  });

  it("Allows a proxy to have multiple senders", async function () {
    const [sender1, sender2, proxy, receiver] = await getEthPoolUsers();
    const proxyWeightBase = sender1.proxyWeightsSum;
    await proxy.setProxyWeights([[receiver, proxyWeightBase]]);
    await sender1.updateSender(
      0,
      proxyWeightBase * 10,
      proxyWeightBase,
      [],
      [[proxy, proxyWeightBase]]
    );
    await sender2.updateSender(
      0,
      proxyWeightBase * 10,
      proxyWeightBase,
      [],
      [[proxy, proxyWeightBase]]
    );
    await elapseTime(9);
    await elapseTimeUntilCycleEnd();
    await receiver.collect(proxyWeightBase * 20);
  });

  it("Allows a sender to be updated while sending to a proxy", async function () {
    const [sender, proxy, receiver1, receiver2] = await getEthPoolUsers();
    const proxyWeightBase = sender.proxyWeightsSum;
    await proxy.setProxyWeights([[receiver1, proxyWeightBase]]);
    await sender.updateSender(
      0,
      proxyWeightBase * 20,
      proxyWeightBase * 2,
      [],
      [[proxy, proxyWeightBase]]
    );
    await elapseTime(4);
    await sender.setReceiver(receiver2, proxyWeightBase);
    await elapseTime(3);
    await elapseTimeUntilCycleEnd();
    // 5 seconds of receiving `2 * proxyWeightBase` and 5 of receiving `proxyWeightBase`
    await receiver1.collect(proxyWeightBase * 15);
    // 5 seconds of receiving `proxyWeightBase`
    await receiver2.collect(proxyWeightBase * 5);
  });

  it("Allows updating a part of proxy receivers list", async function () {
    const [sender, proxy, receiver1, receiver2, receiver3, receiver4] = await getEthPoolUsers();
    const proxyWeightBase = sender.proxyWeightsSum;
    await proxy.setProxyWeights([
      [receiver1, proxyWeightBase * 0.5],
      [receiver2, proxyWeightBase * 0.5],
    ]);
    await proxy.setProxyWeights([
      [receiver2, 0],
      [receiver3, proxyWeightBase * 0.25],
      [receiver4, proxyWeightBase * 0.25],
    ]);
    await sender.updateSender(0, proxyWeightBase, proxyWeightBase, [], [[proxy, proxyWeightBase]]);
    await elapseTimeUntilCycleEnd();
    await receiver1.collect(proxyWeightBase * 0.5);
    await receiver2.expectCollectable(0);
    await receiver3.collect(proxyWeightBase * 0.25);
    await receiver4.collect(proxyWeightBase * 0.25);
  });

  it("Allows updating proxy in the first cycle of sending", async function () {
    const [sender, proxy, receiver1, receiver2, receiver3, receiver4] = await getEthPoolUsers();
    const proxyWeightBase = sender.proxyWeightsSum;
    await proxy.setProxyWeights([
      [receiver1, proxyWeightBase * 0.5],
      [receiver2, proxyWeightBase * 0.5],
    ]);
    await sender.updateSender(0, 0, proxyWeightBase, [], [[proxy, proxyWeightBase]]);
    // Sending spans for two cycles
    await elapseTimeUntilCycleEnd();
    await elapseTime(CYCLE_SECS / 2);
    await sender.topUp(0, proxyWeightBase * CYCLE_SECS);
    await proxy.setProxyWeights([
      [receiver2, 0],
      [receiver3, proxyWeightBase * 0.25],
      [receiver4, proxyWeightBase * 0.25],
    ]);
    await elapseTime(CYCLE_SECS - 1);
    await elapseTimeUntilCycleEnd();
    // Receiving 0.5 proxyWeightBase during both cycles
    await receiver1.collect(proxyWeightBase * 0.5 * CYCLE_SECS);
    await receiver2.expectCollectable(0);
    // Receiving 0.25 proxyWeightBase during both cycles
    await receiver3.expectCollectable(proxyWeightBase * 0.25 * CYCLE_SECS);
    // Receiving 0.25 proxyWeightBase during both cycles
    await receiver4.expectCollectable(proxyWeightBase * 0.25 * CYCLE_SECS);
  });

  it("Allows updating proxy in the middle cycle of sending", async function () {
    const [sender, proxy, receiver1, receiver2, receiver3, receiver4] = await getEthPoolUsers();
    const proxyWeightBase = sender.proxyWeightsSum;
    await proxy.setProxyWeights([
      [receiver1, proxyWeightBase * 0.5],
      [receiver2, proxyWeightBase * 0.5],
    ]);
    await sender.updateSender(0, 0, proxyWeightBase, [], [[proxy, proxyWeightBase]]);
    // Sending spans for three cycles
    await elapseTimeUntilCycleEnd();
    const thirdCycleSeconds = CYCLE_SECS / 2;
    const firstCycleSeconds = CYCLE_SECS - thirdCycleSeconds;
    await elapseTime(thirdCycleSeconds);
    await sender.topUp(0, proxyWeightBase * CYCLE_SECS * 2);
    await elapseTime(CYCLE_SECS - 1);
    await proxy.setProxyWeights([
      [receiver2, 0],
      [receiver3, proxyWeightBase * 0.25],
      [receiver4, proxyWeightBase * 0.25],
    ]);
    await elapseTime(CYCLE_SECS - 1);
    await elapseTimeUntilCycleEnd();
    // Receiving 0.5 proxyWeightBase during all cycles
    await receiver1.collect(proxyWeightBase * 0.5 * CYCLE_SECS * 2);
    // Receiving 0.5 proxyWeightBase during the first cycle
    await receiver2.collect(proxyWeightBase * 0.5 * firstCycleSeconds);
    // Receiving 0.25 proxyWeightBase during the second and the last cycles
    await receiver3.expectCollectable(proxyWeightBase * 0.25 * (CYCLE_SECS + thirdCycleSeconds));
    // Receiving 0.25 proxyWeightBase during the second and the last cycles
    await receiver4.expectCollectable(proxyWeightBase * 0.25 * (CYCLE_SECS + thirdCycleSeconds));
  });

  it("Allows updating proxy in the last cycle of sending", async function () {
    const [sender, proxy, receiver1, receiver2, receiver3, receiver4] = await getEthPoolUsers();
    const proxyWeightBase = sender.proxyWeightsSum;
    await proxy.setProxyWeights([
      [receiver1, proxyWeightBase * 0.5],
      [receiver2, proxyWeightBase * 0.5],
    ]);
    await sender.updateSender(0, 0, proxyWeightBase, [], [[proxy, proxyWeightBase]]);
    // Sending spans for two cycles
    await elapseTimeUntilCycleEnd();
    const secondCycleSeconds = CYCLE_SECS / 2;
    const firstCycleSeconds = CYCLE_SECS - secondCycleSeconds;
    await elapseTime(secondCycleSeconds);
    await sender.topUp(0, proxyWeightBase * CYCLE_SECS);
    await elapseTime(CYCLE_SECS - 1);
    await proxy.setProxyWeights([
      [receiver2, 0],
      [receiver3, proxyWeightBase * 0.25],
      [receiver4, proxyWeightBase * 0.25],
    ]);
    await elapseTimeUntilCycleEnd();
    // Receiving 0.5 proxyWeightBase during both cycles
    await receiver1.collect(proxyWeightBase * 0.5 * CYCLE_SECS);
    // Receiving 0.5 proxyWeightBase during the first cycle
    await receiver2.collect(proxyWeightBase * 0.5 * firstCycleSeconds);
    // Receiving 0.25 proxyWeightBase during the second cycle
    await receiver3.expectCollectable(proxyWeightBase * 0.25 * secondCycleSeconds);
    // Receiving 0.25 proxyWeightBase during the second cycle
    await receiver4.expectCollectable(proxyWeightBase * 0.25 * secondCycleSeconds);
  });

  it("Allows updating proxy in the cycle right after sending finishes", async function () {
    const [sender, proxy, receiver1, receiver2, receiver3, receiver4] = await getEthPoolUsers();
    const proxyWeightBase = sender.proxyWeightsSum;
    await proxy.setProxyWeights([
      [receiver1, proxyWeightBase * 0.5],
      [receiver2, proxyWeightBase * 0.5],
    ]);
    await sender.updateSender(0, 0, proxyWeightBase, [], [[proxy, proxyWeightBase]]);
    await elapseTimeUntilCycleEnd();
    await sender.topUp(0, proxyWeightBase);
    await elapseTimeUntilCycleEnd();
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
    const proxyWeightBase = sender.proxyWeightsSum;
    await sender.setProxyWeights([[sender, proxyWeightBase]]);
    await sender.updateSender(
      0,
      proxyWeightBase * 2,
      proxyWeightBase * 2,
      [[sender, proxyWeightBase]],
      [[sender, proxyWeightBase]]
    );
    await elapseTimeUntilCycleEnd();
    await sender.collect(proxyWeightBase * 2);
  });

  it("Rejects adding a nonexistent proxy", async function () {
    const [sender, proxy] = await getEthPoolUsers();
    await sender.expectSetProxyReverts(proxy, 100, "Proxy doesn't exist");
  });

  it("Rejects adding a proxy weight not being a multiple of proxy weights sum", async function () {
    const [sender, proxy, receiver] = await getEthPoolUsers();
    const proxyWeightBase = sender.proxyWeightsSum;
    await proxy.setProxyWeights([[receiver, proxyWeightBase]]);
    await sender.expectSetProxyReverts(
      proxy,
      99,
      "Proxy weight not a multiple of PROXY_WEIGHTS_SUM"
    );
  });

  it("Limits the total proxy receivers weights sum", async function () {
    const [sender, proxy, receiver] = await getEthPoolUsers();
    const proxyWeightBase = sender.proxyWeightsSum;
    await proxy.setProxyWeights([[receiver, proxyWeightBase]]);
    // Total weight too big by 1
    await sender.setReceiver(receiver, sender.senderWeightsSumMax - proxyWeightBase + 1);
    await sender.expectSetProxyReverts(proxy, proxyWeightBase, "Too much total receivers weight");
    // Total weight maxed out
    await sender.setReceiver(receiver, sender.senderWeightsSumMax - proxyWeightBase);
    await sender.setProxy(proxy, proxyWeightBase);
  });

  it("Limits the overflowing total proxy receivers weights sum", async function () {
    const [sender, proxy, receiver] = await getEthPoolUsers();
    const proxyWeightBase = sender.proxyWeightsSum;
    await proxy.setProxyWeights([[receiver, proxyWeightBase]]);
    const targetTotalWeight = 2 ** 32;
    const proxyWeight = targetTotalWeight - (targetTotalWeight % proxyWeightBase);
    await sender.setReceiver(receiver, targetTotalWeight - proxyWeight);
    await sender.expectSetProxyReverts(proxy, proxyWeight, "Too much total receivers weight");
  });

  it("Limits the total proxy receivers count", async function () {
    const [sender, proxy, receiver] = await getEthPoolUsers();
    const proxyWeightBase = sender.proxyWeightsSum;
    await proxy.setProxyWeights([[receiver, proxyWeightBase]]);
    const receivers = new Array(sender.senderWeightsCountMax - sender.proxyWeightsCountMax)
      .fill(0)
      .map(() => ({ receiver: randomAddress(), weight: 1 }));
    await submit(
      sender.submitUpdateSender(0, 0, sender.amtPerSecUnchanged, receivers, []),
      "updateSender"
    );
    // Total weight too big by 1
    await sender.setReceiver(receiver, 1);
    await sender.expectSetProxyReverts(proxy, proxyWeightBase, "Too many receivers");
    // Total count maxed out
    await sender.setReceiver(receiver, 0);
    await sender.setProxy(proxy, proxyWeightBase);
  });

  it("Rejects creation of a proxy with an invalid weights sum", async function () {
    const [proxy, receiver] = await getEthPoolUsers();
    const proxyWeightSum = proxy.proxyWeightsSum;
    await proxy.expectSetProxyWeightsReverts(
      [[receiver, proxyWeightSum + 1]],
      "Proxy doesn't have the constant weight sum"
    );
  });

  it("Rejects update of a proxy with an invalid weights sum", async function () {
    const [proxy, receiver] = await getEthPoolUsers();
    const proxyWeightSum = proxy.proxyWeightsSum;
    await proxy.setProxyWeights([[receiver, proxyWeightSum]]);
    await proxy.expectSetProxyWeightsReverts(
      [[receiver, proxyWeightSum + 1]],
      "Proxy doesn't have the constant weight sum"
    );
  });

  it("Rejects creation of a proxy could overflow the weights sum", async function () {
    const [proxy, receiver1, receiver2] = await getEthPoolUsers();
    const proxyWeightSum = proxy.proxyWeightsSum;
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
    const proxyWeightSum = proxy.proxyWeightsSum;
    const proxyWeightCountMax = proxy.proxyWeightsCountMax;
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
    await sender.updateSender(0, 10, 1, [[receiver, 1]], []);
    await elapseTime(3);
    await sender.submitChangingBalance(
      () => sender.submitUpdateSender(0, sender.withdrawAll, sender.amtPerSecUnchanged, [], []),
      "updateSender",
      6
    );
    await sender.expectWithdrawable(0);
    await elapseTimeUntilCycleEnd();
    // Receiver had 4 seconds paying 1 per second
    await receiver.collect(4);
  });
});

describe("Erc20Pool", function () {
  runCommonPoolTests(getErc20PoolUsers);

  it("Allows withdrawal of funds", async function () {
    const [sender] = await getErc20PoolUsers();
    await sender.topUp(0, 10);
    await sender.withdraw(10, 0);
  });

  it("Allows collecting funds", async function () {
    const [sender, receiver] = await getErc20PoolUsers();
    await sender.updateSender(0, 10, 10, [[receiver, 1]], []);
    await elapseTimeUntilCycleEnd();
    await receiver.collect(10);
  });
});

function runCommonPoolTests(getPoolUsers: () => Promise<PoolUser<AnyPool>[]>): void {
  it("Allows full sender update with top up", async function () {
    const [sender, proxy, receiver1, receiver2] = await getPoolUsers();
    const proxyWeightBase = sender.proxyWeightsSum;
    await proxy.setProxyWeights([[receiver2, proxyWeightBase]]);
    await sender.updateSender(
      0,
      proxyWeightBase * 6,
      proxyWeightBase * 3,
      [[receiver1, proxyWeightBase]],
      [[proxy, proxyWeightBase * 2]]
    );
    await elapseTimeUntilCycleEnd();
    await receiver1.collect(proxyWeightBase * 2);
    await receiver2.collect(proxyWeightBase * 4);
  });

  it("Allows full sender update with withdrawal", async function () {
    const [sender, proxy, receiver1, receiver2] = await getPoolUsers();
    const proxyWeightBase = sender.proxyWeightsSum;
    await proxy.setProxyWeights([[receiver2, proxyWeightBase]]);
    await sender.topUp(0, proxyWeightBase * 12);
    await sender.updateSender(
      proxyWeightBase * 12,
      proxyWeightBase * 6,
      proxyWeightBase * 3,
      [[receiver1, proxyWeightBase]],
      [[proxy, proxyWeightBase * 2]]
    );
    await elapseTimeUntilCycleEnd();
    await receiver1.collect(proxyWeightBase * 2);
    await receiver2.collect(proxyWeightBase * 4);
  });

  it("Allows sender update with top up and withdrawal", async function () {
    const [sender] = await getPoolUsers();
    await sender.submitChangingBalance(
      () => sender.submitUpdateSender(10, 3, sender.amtPerSecUnchanged, [], []),
      "updateSender",
      -7
    );
    await sender.expectWithdrawable(7);
  });

  it("Allows no sender update", async function () {
    const [sender, proxy, receiver1, receiver2] = await getPoolUsers();
    const proxyWeightBase = sender.proxyWeightsSum;
    await proxy.setProxyWeights([[receiver2, proxyWeightBase]]);
    await sender.updateSender(
      0,
      proxyWeightBase * 6,
      proxyWeightBase * 3,
      [[receiver1, proxyWeightBase]],
      [[proxy, proxyWeightBase * 2]]
    );
    // Sender has sent proxyWeightBase * 3
    await sender.updateSender(
      proxyWeightBase * 3,
      proxyWeightBase * 3,
      sender.amtPerSecUnchanged,
      [],
      []
    );
    await elapseTimeUntilCycleEnd();
    await receiver1.collect(proxyWeightBase * 2);
    await receiver2.collect(proxyWeightBase * 4);
  });
}
