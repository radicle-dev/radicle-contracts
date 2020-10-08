import * as Ethers from "ethers";
import {assert, expect} from "chai";
import buidler from "@nomiclabs/buidler";

export async function wait(
  response: Promise<Ethers.ContractTransaction>
): Promise<Ethers.ContractReceipt> {
  return (await response).wait();
}

/// Submit a transaction and wait for it to be mined. Then assert that it succeeded.
export async function submit(
  tx: Promise<Ethers.ContractTransaction>
): Promise<Ethers.ContractReceipt> {
  const receipt = await (await tx).wait();
  assert.equal(receipt.status, 1, "transaction must be successful");

  console.log("Gas used: ", receipt.gasUsed.toString());

  return receipt;
}

/// Submit a transaction and expect it to fail. Throws an error if it succeeds.
export async function submitFailing(
  tx: Promise<Ethers.ContractTransaction>
): Promise<void> {
  try {
    await (await tx).wait();
  } catch {
    return;
  }
  expect.fail("Expected transaction to fail");
}

/// Let a certain amount of time pass.
export async function elapseTime(time: number): Promise<void> {
  await buidler.ethers.provider.send("evm_increaseTime", [time]);
  await buidler.ethers.provider.send("evm_mine", []);
}
