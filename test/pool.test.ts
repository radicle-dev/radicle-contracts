import { Dai } from "../contract-bindings/ethers/Dai";
import { IERC20 } from "../contract-bindings/ethers/IERC20";
import { DaiPool } from "../contract-bindings/ethers/DaiPool";
import { Erc20Pool } from "../contract-bindings/ethers/Erc20Pool";
import { EthPool } from "../contract-bindings/ethers/EthPool";
import { ethers } from "hardhat";
import {
  utils,
  Signer,
  BigNumber,
  BigNumberish,
  ContractReceipt,
  ContractTransaction,
} from "ethers";
import { expect } from "chai";
import {
  expectBigNumberEq,
  getSigningKey,
  submit,
  submitFailing,
} from "./support";
import { deployDaiPool, deployErc20Pool, deployEthPool, deployTestDai } from "../src/deploy";
import { daiPermitDigest } from "../src/utils";

const CYCLE_SECS = 10;

type AnyPool = EthPool | Erc20Pool | DaiPool;

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
    const receipt = await this.submitChangingBalance(
      () => this.pool.collect({ gasPrice: 0 }),
      "collect",
      expectedAmount
    );
    await this.expectCollectable(0);
    await this.expectCollectedEvent(receipt, expectedAmount);
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

    const receipt = await this.updateSenderRawBalance(
      topUp,
      withdraw,
      balanceDelta,
      amtPerSec,
      setReceivers,
      setProxies
    );

    await this.expectWithdrawable(balanceTo);
    await this.expectUpdateSenderEvent(receipt, balanceTo, expectedAmtPerSec);
  }

  async updateSenderBalanceUnchanged(
    amtPerSec: BigNumberish,
    setReceivers: ReceiverWeights,
    setProxies: ReceiverWeights
  ): Promise<void> {
    await this.updateSenderRawBalance(0, 0, 0, amtPerSec, setReceivers, setProxies);
  }

  async updateSenderRawBalance(
    topUp: BigNumberish,
    withdraw: BigNumberish,
    balanceDelta: BigNumberish,
    amtPerSec: BigNumberish,
    setReceivers: ReceiverWeights,
    setProxies: ReceiverWeights
  ): Promise<ContractReceipt> {
    const expectedAmtPerSec = await this.expectedAmtPerSec(amtPerSec);
    const receiversAddr = receiverWeightsAddr(setReceivers);
    const proxiesAddr = receiverWeightsAddr(setProxies);
    const expectedReceivers = await this.expectedReceivers(receiversAddr, proxiesAddr);
    const oldActiveReceivers = await this.getActiveReceivers();

    const receipt = await this.submitChangingBalance(
      () => this.submitUpdateSender(topUp, withdraw, amtPerSec, receiversAddr, proxiesAddr),
      "updateSender",
      balanceDelta
    );

    await this.expectAmtPerSec(expectedAmtPerSec);
    await this.expectReceivers(expectedReceivers);
    await this.expectUpdateSenderStreamsEvents(oldActiveReceivers, receipt);
    return receipt;
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

  async expectCollectable(amount: number): Promise<void> {
    const collectable = (await this.pool.collectable()).toNumber();
    expect(collectable).to.equal(
      amount,
      "The collectable amount is different from the expected amount"
    );
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

  // Check if the sender update generated proper stream update events.
  // `oldActiveReceivers` - the receivers of `this` sender, which were
  // receiving anything at the time of the update
  async expectUpdateSenderStreamsEvents(
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

  // Check if the sender update generated proper events.
  async expectUpdateSenderEvent(
    receipt: ContractReceipt,
    expectedBalance: BigNumberish,
    expectedAmtPerSec: BigNumberish
  ): Promise<void> {
    const filter = this.pool.filters.SenderUpdated(null, null, null);
    const events = await this.pool.queryFilter(filter, receipt.blockHash);
    expect(events.length).to.be.equal(1, "Expected a single UpdateSender event");
    const { sender, balance, amtPerSec } = events[0].args;
    expect(sender).to.equal(receipt.from, "UpdateSender event has an invalid sender");
    expectBigNumberEq(balance, expectedBalance, "UpdateSender event has an invalid balance");
    expectBigNumberEq(amtPerSec, expectedAmtPerSec, "UpdateSender event has an invalid amtPerSec");
  }

  // Check if funds collection generated proper events.
  async expectCollectedEvent(receipt: ContractReceipt, expectedAmt: BigNumberish): Promise<void> {
    const filter = this.pool.filters.Collected(null, null);
    const events = await this.pool.queryFilter(filter, receipt.blockHash);
    expect(events.length).to.be.equal(1, "Expected a single Collected event");
    const { receiver, amt } = events[0].args;
    expect(receiver).to.equal(receipt.from, "Collected event has an invalid receiver");
    expectBigNumberEq(amt, expectedAmt, "Collected event has an invalid amt");
  }
}

async function getEthPoolUsers(): Promise<EthPoolUser[]> {
  const signers = await ethers.getSigners();
  const pool = await deployEthPool(signers[0], CYCLE_SECS);
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
  const erc20 = await deployTestDai(signers[0]);
  const pool = await deployErc20Pool(signers[0], CYCLE_SECS, erc20.address);
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

async function getDaiPoolUsers(): Promise<DaiPoolUser[]> {
  const signers = await ethers.getSigners();
  const dai = await deployTestDai(signers[0]);
  const pool = await deployDaiPool(signers[0], CYCLE_SECS, dai.address);
  const constants = await poolConstants(pool);

  const supplyPerUser = (await dai.totalSupply()).div(signers.length);
  const users = [];
  for (const signer of signers) {
    const user = await DaiPoolUser.new(pool, dai, signer, constants);
    await dai.transfer(user.addr, supplyPerUser);
    users.push(user);
  }
  return users;
}

class DaiPoolUser extends Erc20PoolUser {
  dai: Dai;
  daiPool: DaiPool;

  constructor(daiPool: DaiPool, userAddr: string, constants: PoolConstants, dai: Dai) {
    super(daiPool, userAddr, constants, dai);
    this.dai = dai;
    this.daiPool = daiPool;
  }

  static async new(
    pool: DaiPool,
    dai: Dai,
    signer: Signer,
    constants: PoolConstants
  ): Promise<DaiPoolUser> {
    const userPool = pool.connect(signer);
    const userAddr = await signer.getAddress();
    const userDai = dai.connect(signer);
    return new DaiPoolUser(userPool, userAddr, constants, userDai);
  }

  async submitUpdateSender(
    topUp: BigNumberish,
    withdraw: BigNumberish,
    amtPerSec: BigNumberish,
    setReceivers: ReceiverWeightsAddr,
    setProxies: ReceiverWeightsAddr
  ): Promise<ContractTransaction> {
    const nonce = await this.dai.nonces(this.addr);
    const expiry = 0; // never expires
    const digest = daiPermitDigest(
      this.dai.address,
      await this.pool.signer.getChainId(),
      this.addr, // holder
      this.pool.address, // spender
      nonce,
      expiry,
      true // allowed
    );
    const signature = getSigningKey(this.addr).signDigest(digest);
    const { r, s, v } = utils.splitSignature(signature);
    return this.daiPool.updateSenderAndPermit(
      topUp,
      withdraw,
      amtPerSec,
      setReceivers,
      setProxies,
      nonce,
      expiry,
      v,
      r,
      s
    );
  }
}

describe("EthPool", function () {
  it("Does not require receiver to be initialized", async function () {
    const [receiver] = await getEthPoolUsers();
    await receiver.collect(0);
  });

  it("Allows not changing amount per second", async function () {
    const [sender] = await getEthPoolUsers();
    await sender.setAmtPerSec(10);
    await sender.setAmtPerSec(sender.amtPerSecUnchanged);
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
});

describe("Erc20Pool", function () {
  it("Allows withdrawal of funds", async function () {
    const [sender] = await getErc20PoolUsers();
    await sender.topUp(0, 10);
    await sender.withdraw(10, 0);
  });
});

describe("DaiPool", function () {
  it("Allows sender update", async function () {
    const [sender, receiver] = await getDaiPoolUsers();
    await sender.updateSender(0, 10, 10, [[receiver, 1]], []);
  });
});
