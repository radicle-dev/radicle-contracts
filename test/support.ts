import { BigNumber, BigNumberish, ContractReceipt, ContractTransaction, utils } from "ethers";
import { expect } from "chai";
import { ethers, network } from "hardhat";

export { nextDeployedContractAddr } from "../src/deploy";

export async function wait(response: Promise<ContractTransaction>): Promise<ContractReceipt> {
  return (await response).wait();
}

// Enable when optimizing contracts for gas usage
const PRINT_GAS_USAGE = false;

/// Submit a transaction and wait for it to be mined. Then assert that it succeeded.
export async function submit(
  tx: Promise<ContractTransaction>,
  txName = "transaction"
): Promise<ContractReceipt> {
  const receipt = await (await tx).wait();
  if (PRINT_GAS_USAGE || process.env.PRINT_GAS_USAGE) {
    console.log("Gas used for " + txName + ": " + receipt.gasUsed.toString());
  }
  return receipt;
}

/// Submit a transaction and expect it to fail. Throws an error if it succeeds.
export async function submitFailing(
  tx: Promise<ContractTransaction>,
  txName?: string,
  expectedCause?: string
): Promise<void> {
  const receipt = tx.then((result) => result.wait());
  await expectTxFail(receipt, txName, expectedCause);
}

/// Expect a transaction to fail. Throws an error if it succeeds.
export async function expectTxFail<T>(
  tx: Promise<T>,
  txName = "transaction",
  expectedCause?: string
): Promise<void> {
  try {
    await tx;
  } catch (error) {
    // console.log("GOT ERROR", JSON.stringify(error));
    if (expectedCause) {
      // This property needs to be accessed before checking error type to avoid the type checker
      const details = error.error;
      if (!(error instanceof Error)) {
        throw error;
      }
      // The body property may be in one of 2 places
      const body = details.body ? details.body : details.error.body;
      const cause = JSON.parse(body).error.message.replace("execution reverted: ", "");
      expect(cause).to.equal(expectedCause, txName + " failed because of an unexpected reason");
    }
    return;
  }
  expect.fail("Expected " + txName + " to fail");
}

/// Let a certain amount of time pass.
export async function elapseTime(elapsed: number): Promise<void> {
  const latestBlock = await ethers.provider.getBlock("latest");
  // `evm_elapseTime` doesn't prevent the next block timestamp from increasing before mining
  await elapseTimeUntil(latestBlock.timestamp + elapsed);
}

export async function elapseTimeUntil(timestamp: number): Promise<void> {
  await ethers.provider.send("evm_setNextBlockTimestamp", [timestamp]);
  await mineBlocks(1);
}

export async function mineBlocks(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await ethers.provider.send("evm_mine", []);
  }
}

export function randomAddresses(): string[] {
  return new Array(10).fill(0).map(() => randomAddress());
}

export function randomAddress(): string {
  return numberToAddress(utils.randomBytes(20));
}

export function numberToAddress(num: BigNumberish): string {
  const hex = utils.hexlify(num);
  const padded = utils.hexZeroPad(hex, 20);
  return utils.getAddress(padded);
}

export function getSigningKey(address: string): utils.SigningKey {
  const { initialIndex, count, path, mnemonic } = network.config.accounts as {
    initialIndex: number;
    count: number;
    path: string;
    mnemonic: string;
  };
  const parentNode = utils.HDNode.fromMnemonic(mnemonic).derivePath(path);
  for (let index = initialIndex; index < initialIndex + count; index++) {
    const node = parentNode.derivePath(index.toString());
    if (node.address == address) {
      return new utils.SigningKey(node.privateKey);
    }
  }
  throw `No private key found for address ${address}`;
}

export function expectBigNumberEq(
  actual: BigNumberish,
  expected: BigNumberish,
  message: string
): void {
  const fullMessage = `${message} (actual: ${actual.toString()}, expected: ${expected.toString()})`;
  expect(BigNumber.from(actual).eq(expected)).to.equal(true, fullMessage);
}
