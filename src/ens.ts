import * as ethers from "ethers";

// Return the hash of an ENS domain name as a hex string with leading `0x`.
//
// See https://docs.ens.domains/contract-api-reference/name-processing#hashing-names
export function nameHash(name: string): string {
  let node =
    "0x0000000000000000000000000000000000000000000000000000000000000000";
  if (name == "") {
    return node;
  }
  for (const label of name.split(".").reverse()) {
    node = ethers.utils.keccak256(node + labelHash(label).slice(2));
  }
  return node;
}

// Return the hash of an ENS label as a hex string with leading `0x`.
export function labelHash(label: string): string {
  return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(label));
}
