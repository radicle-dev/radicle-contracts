import * as Ethers from "ethers";
import {assert} from "chai";

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

  return receipt;
}
