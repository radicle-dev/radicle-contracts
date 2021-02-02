import { utils } from "ethers";

// Return the hash of an ENS label as a hex string with leading `0x`.
export function labelHash(label: string): string {
  return utils.keccak256(utils.toUtf8Bytes(label));
}
