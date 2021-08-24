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
  callOnNextBlock,
  elapseTime,
  elapseTimeUntil,
  expectBigNumberEq,
  getSigningKey,
  randomAddress,
  submit,
  submitFailing,
} from "./support";
import { deployDaiPool, deployErc20Pool, deployEthPool, deployTestDai } from "../src/deploy";
import { daiPermitDigest } from "../src/utils";

const CYCLE_SECS = 10;

// Elapses time until the next cycle is reached, at least 1 second.
// The next transaction will be executed on the first second of the next cycle,
// but the next call will be executed on the last second of the current cycle.
async function elapseTimeUntilCycleEnd(): Promise<void> {
  const latestBlock = await ethers.provider.getBlock("latest");
  await elapseTimeUntil(Math.ceil((latestBlock.timestamp + 2) / CYCLE_SECS) * CYCLE_SECS - 1);
}

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

type ReceiverWeightsMap = Map<string, number>;

function updateReceiverWeights(
  weights: ReceiverWeightsMap,
  receiver: string,
  weight: number
): void {
  if (weight == 0) {
    weights.delete(receiver);
  } else {
    weights.set(receiver, weight);
  }
}

interface PoolConstants {
  senderWeightsSumMax: number;
  senderWeightsCountMax: number;
  withdrawAll: BigNumber;
  amtPerSecUnchanged: BigNumber;
}

async function poolConstants(pool: AnyPool): Promise<PoolConstants> {
  return {
    senderWeightsSumMax: await pool.SENDER_WEIGHTS_SUM_MAX(),
    senderWeightsCountMax: await pool.SENDER_WEIGHTS_COUNT_MAX(),
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
  withdrawAll: BigNumber;
  amtPerSecUnchanged: BigNumber;
  maxTimestamp: BigNumber;

  constructor(pool: Pool, userAddr: string, constants: PoolConstants) {
    this.pool = pool;
    this.addr = userAddr;
    this.senderWeightsSumMax = constants.senderWeightsSumMax;
    this.senderWeightsCountMax = constants.senderWeightsCountMax;
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
    setReceivers: ReceiverWeightsAddr
  ): Promise<ContractTransaction>;

  async collect(expectedAmount: number): Promise<void> {
    await this.expectCollectableOnNextBlock(expectedAmount);
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
    setReceivers: ReceiverWeights
  ): Promise<void> {
    const balanceDelta = BigNumber.from(balanceFrom).sub(balanceTo);
    const topUp = balanceDelta.lt(0) ? balanceDelta.abs() : 0;
    const withdraw = balanceDelta.gt(0) ? balanceDelta : 0;
    const expectedAmtPerSec = await this.expectedAmtPerSec(amtPerSec);
    const receiversAddr = receiverWeightsAddr(setReceivers);
    const expectedReceivers = await this.expectedReceivers(receiversAddr);
    const oldActiveReceivers = await this.getActiveReceivers();
    await this.expectWithdrawableOnNextBlock(balanceFrom);

    const receipt = await this.submitChangingBalance(
      () => this.submitUpdateSender(topUp, withdraw, amtPerSec, receiversAddr),
      "updateSender",
      balanceDelta
    );

    await this.expectWithdrawable(balanceTo);
    await this.expectAmtPerSec(expectedAmtPerSec);
    await this.expectReceivers(expectedReceivers);
    await this.expectUpdateSenderStreamsEvents(oldActiveReceivers, receipt);
    await this.expectUpdateSenderEvent(receipt, balanceTo, expectedAmtPerSec);
  }

  async updateSenderBalanceUnchanged(
    amtPerSec: BigNumberish,
    setReceivers: ReceiverWeights
  ): Promise<void> {
    const balance = await callOnNextBlock(() => this.pool.withdrawable());
    await this.updateSender(balance, balance, amtPerSec, setReceivers);
  }

  async expectUpdateSenderBalanceUnchangedReverts(
    amtPerSec: BigNumberish,
    setReceivers: ReceiverWeights,
    expectedCause: string
  ): Promise<void> {
    await submitFailing(
      this.submitUpdateSender(0, 0, amtPerSec, receiverWeightsAddr(setReceivers)),
      "updateSender",
      expectedCause
    );
  }

  async topUp(balanceFrom: BigNumberish, balanceTo: BigNumberish): Promise<void> {
    await this.updateSender(balanceFrom, balanceTo, this.amtPerSecUnchanged, []);
  }

  async withdraw(balanceFrom: BigNumberish, balanceTo: BigNumberish): Promise<void> {
    await this.updateSender(balanceFrom, balanceTo, this.amtPerSecUnchanged, []);
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
    await this.updateSenderBalanceUnchanged(amount, []);
  }

  async getAmtPerSec(): Promise<number> {
    return (await this.pool.getAmtPerSec()).toNumber();
  }

  async setReceivers(receivers: ReceiverWeights): Promise<void> {
    await this.updateSenderBalanceUnchanged(this.amtPerSecUnchanged, receivers);
  }

  async setReceiver(receiver: this, weight: number): Promise<void> {
    await this.updateSenderBalanceUnchanged(this.amtPerSecUnchanged, [[receiver, weight]]);
  }

  async getActiveReceivers(): Promise<ReceiverWeightsMap> {
    const allReceivers = await this.getAllReceivers();
    const amtPerSec = await this.getAmtPerSec();
    let weightsSum = 0;
    for (const weight of allReceivers.values()) {
      weightsSum += weight;
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
      expectedCause
    );
  }

  async getAllReceivers(): Promise<ReceiverWeightsMap> {
    const receivers = await this.pool.getAllReceivers();
    return new Map(receivers.map(({ receiver, weight }) => [receiver, weight]));
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
  async expectedReceivers(receivers: ReceiverWeightsAddr): Promise<ReceiverWeightsMap> {
    const allReceivers = await this.getAllReceivers();
    receivers.forEach(({ receiver, weight }) =>
      updateReceiverWeights(allReceivers, receiver, weight)
    );
    return allReceivers;
  }

  async expectReceivers(receivers: ReceiverWeightsMap): Promise<void> {
    const receiversActual = await this.getAllReceivers();
    expect(receiversActual).to.deep.equal(receivers, "Unexpected receivers list");
  }

  // Check if the sender update generated proper stream update events.
  // `oldActiveReceivers` - the receivers of `this` sender, which were
  // receiving anything at the time of the update
  async expectUpdateSenderStreamsEvents(
    oldActiveReceivers: ReceiverWeightsMap,
    receipt: ContractReceipt
  ): Promise<void> {
    const receiverFilter = this.pool.filters.SenderToReceiverUpdated(null, null, null, null);
    const receiverEvents = await this.pool.queryFilter(receiverFilter, receipt.blockHash);

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

    // Assert that all old receivers who have been getting funds have stop sending events
    const sender = receipt.from;
    const blockTime = (await this.pool.provider.getBlock(receipt.blockHash)).timestamp;
    for (const receiver of oldActiveReceivers.keys()) {
      const errorPrefix = "Stop sending event for receiver " + receiver + " ";
      const idx = receiverEvents.findIndex((event) => event.args.receiver == receiver);
      expect(idx).to.be.not.equal(-1, errorPrefix + "not found");
      const [event] = receiverEvents.splice(idx, 1);
      expect(event.args.sender).to.equal(sender, errorPrefix + "has invalid sender");
      expectBigNumberEq(event.args.amtPerSec, 0, errorPrefix + "has invalid amtPerSec");
      expectBigNumberEq(event.args.endTime, blockTime, errorPrefix + "has invalid end time");
    }

    // Assert that all current receivers who are getting funds have start sending events
    const activeReceivers = await this.getActiveReceivers();
    let weightsSum = 0;
    for (const weight of activeReceivers.values()) {
      weightsSum += weight;
    }
    const amtPerSecPerWeight = Math.floor((await this.getAmtPerSec()) / weightsSum);
    const amtPerSec = amtPerSecPerWeight * weightsSum;
    const timeLeft = Number.isInteger(amtPerSec)
      ? (await this.pool.withdrawable()).div(amtPerSec)
      : BigNumber.from(0);
    let endTime = timeLeft.add(blockTime);
    endTime = endTime.gt(this.maxTimestamp) ? this.maxTimestamp : endTime;
    for (const [receiver, weight] of activeReceivers) {
      const errorPrefix = "Start sending event for receiver " + receiver + " ";
      const idx = receiverEvents.findIndex((event) => event.args.receiver == receiver);
      expect(idx).to.be.not.equal(-1, errorPrefix + "not found");
      const [event] = receiverEvents.splice(idx, 1);
      expect(event.args.sender).to.equal(sender, errorPrefix + "has invalid sender");
      const amtPerSec = amtPerSecPerWeight * weight;
      expectBigNumberEq(event.args.amtPerSec, amtPerSec, errorPrefix + "has invalid amtPerSec");
      expectBigNumberEq(event.args.endTime, endTime, errorPrefix + "has invalid end time");
    }

    expect(receiverEvents, "Excess sending to a receiver update events").to.be.empty;
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
    setReceivers: ReceiverWeightsAddr
  ): Promise<ContractTransaction> {
    return this.pool.updateSender(withdraw, amtPerSec, setReceivers, {
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
    setReceivers: ReceiverWeightsAddr
  ): Promise<ContractTransaction> {
    return this.pool.updateSender(topUp, withdraw, amtPerSec, setReceivers);
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
    setReceivers: ReceiverWeightsAddr
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
      nonce,
      expiry,
      v,
      r,
      s
    );
  }
}

describe("EthPool", function () {
  runCommonPoolTests(getEthPoolUsers);

  it("Sends funds from a single sender to a single receiver", async function () {
    const [sender, receiver] = await getEthPoolUsers();
    await sender.updateSender(0, 100, 1, [[receiver, 1]]);
    await elapseTime(15);
    // Sender had 16 seconds paying 1 per second
    await sender.withdraw(84, 0);
    await elapseTimeUntilCycleEnd();
    // Sender had 16 seconds paying 1 per second
    await receiver.collect(16);
  });

  it("Sends some funds from a single sender to two receivers", async function () {
    const [sender, receiver1, receiver2] = await getEthPoolUsers();
    await sender.updateSender(0, 100, 2, [
      [receiver1, 1],
      [receiver2, 1],
    ]);
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
    await sender1.updateSender(0, 100, 1, [[receiver, 1]]);
    await sender2.updateSender(0, 100, 2, [[receiver, 1]]);
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
    await sender.updateSender(0, CYCLE_SECS + 10, 1, []);
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
    await sender.updateSender(0, 100, 9, [[receiver, 1]]);
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
    await sender.updateSender(0, 100, 10, [[receiver, 1]]);
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
    await sender.updateSender(0, 100, 10, [[receiver, 1]]);
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
    await sender.updateSender(0, toppedUp, 1, [[receiver, 1]]);
    await elapseTime(9);
    // Sender had 10 seconds paying 1 per second
    await sender.withdraw(toppedUp.sub(10), 0);
    await elapseTimeUntilCycleEnd();
    // Receiver had 10 seconds paying 1 per second
    await receiver.collect(10);
  });

  it("Allows changing amount per second while sending", async function () {
    const [sender, receiver] = await getEthPoolUsers();
    await sender.updateSender(0, 100, 10, [[receiver, 1]]);
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
    await sender.updateSender(0, 100, 9, [[receiver, 5]]);
    await elapseTime(4);
    // Sender had 5 seconds paying 5 per second
    await sender.withdraw(75, 0);
    await elapseTimeUntilCycleEnd();
    // Receiver had 5 seconds paying 5 per second
    await receiver.collect(25);
  });

  it("Sends nothing if amount per second is smaller than weights sum", async function () {
    const [sender, receiver] = await getEthPoolUsers();
    await sender.updateSender(0, 100, 4, [[receiver, 5]]);
    await elapseTime(4);
    // Sender had no paying seconds
    await sender.withdraw(100, 0);
    await elapseTimeUntilCycleEnd();
    // Receiver had no paying seconds
    await receiver.collect(0);
  });

  it("Allows removing the last receiver weight when amount per second is zero", async function () {
    const [sender, receiver1, receiver2] = await getEthPoolUsers();
    await sender.updateSender(0, 100, 12, [
      [receiver1, 1],
      [receiver2, 1],
      [receiver2, 0],
    ]);
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
    await sender.updateSender(0, 100, 12, [
      [receiver1, 1],
      [receiver2, 1],
    ]);
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
    await sender.updateSender(0, 100, 10, [
      [receiver1, 1],
      [receiver2, 1],
    ]);
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
      sender.submitUpdateSender(0, 0, sender.amtPerSecUnchanged, receivers),
      "updateSender"
    );
    await sender.expectSetReceiverReverts(receiver, 1, "Too many receivers");
  });

  it("Allows sending to multiple receivers", async function () {
    const [sender, receiver1, receiver2] = await getEthPoolUsers();
    await sender.updateSender(0, 6, 3, [
      [receiver1, 1],
      [receiver2, 2],
    ]);
    await elapseTimeUntilCycleEnd();
    await receiver1.collect(2);
    await receiver2.collect(4);
  });

  it("Allows an address to be a sender and a receiver independently", async function () {
    const [sender] = await getEthPoolUsers();
    await sender.updateSender(0, 10, 10, [[sender, 10]]);
    await elapseTimeUntilCycleEnd();
    await sender.collect(10);
  });

  it("Allows withdrawal of all funds", async function () {
    const [sender, receiver] = await getEthPoolUsers();
    const amtPerSec = 1;
    await sender.updateSender(0, 10, amtPerSec, [[receiver, 1]]);
    const receivers = await sender.getAllReceivers();
    await elapseTime(3);
    const receipt = await sender.submitChangingBalance(
      () => sender.submitUpdateSender(0, sender.withdrawAll, sender.amtPerSecUnchanged, []),
      "updateSender",
      6
    );
    await sender.expectWithdrawable(0);
    await sender.expectAmtPerSec(amtPerSec);
    await sender.expectReceivers(receivers);
    await sender.expectUpdateSenderStreamsEvents(receivers, receipt);
    await sender.expectUpdateSenderEvent(receipt, 0, amtPerSec);
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
    await sender.updateSender(0, 10, 10, [[receiver, 1]]);
    await elapseTimeUntilCycleEnd();
    await receiver.collect(10);
  });
});

describe("DaiPool", function () {
  it("Allows sender update", async function () {
    const [sender, receiver] = await getDaiPoolUsers();
    await sender.updateSender(0, 10, 10, [[receiver, 1]]);
  });
});

function runCommonPoolTests(getPoolUsers: () => Promise<PoolUser<AnyPool>[]>): void {
  it("Allows full sender update with top up", async function () {
    const [sender, receiver] = await getPoolUsers();
    await sender.updateSender(0, 10, 10, [[receiver, 1]]);
    await elapseTimeUntilCycleEnd();
    await receiver.collect(10);
  });

  it("Allows full sender update with withdrawal", async function () {
    const [sender, receiver] = await getPoolUsers();
    await sender.topUp(0, 12);
    await sender.updateSender(12, 10, 10, [[receiver, 1]]);
    await elapseTimeUntilCycleEnd();
    await receiver.collect(10);
  });

  it("Allows sender update with top up and withdrawal", async function () {
    const [sender] = await getPoolUsers();
    const receipt = await sender.submitChangingBalance(
      () => sender.submitUpdateSender(10, 3, sender.amtPerSecUnchanged, []),
      "updateSender",
      -7
    );
    await sender.expectWithdrawable(7);
    await sender.expectAmtPerSec(0);
    await sender.expectReceivers(new Map());
    await sender.expectUpdateSenderStreamsEvents(new Map(), receipt);
    await sender.expectUpdateSenderEvent(receipt, 7, 0);
  });

  it("Allows no sender update", async function () {
    const [sender, receiver] = await getPoolUsers();
    await sender.updateSender(0, 6, 3, [[receiver, 1]]);
    // Sender has sent 3
    await sender.updateSender(3, 3, sender.amtPerSecUnchanged, []);
    await elapseTimeUntilCycleEnd();
    await receiver.collect(6);
  });
}
