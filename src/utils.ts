import { utils, BigNumberish } from "ethers";

export function daiPermitDigest(
  daiContract: string,
  chainId: BigNumberish,
  holder: string,
  spender: string,
  nonce: BigNumberish,
  expiry: BigNumberish,
  allowed: boolean
): Uint8Array {
  const domain = {
    name: "DAI Stablecoin",
    version: "1",
    chainId,
    verifyingContract: daiContract,
  };
  const types = {
    Permit: [
      { name: "holder", type: "address" },
      { name: "spender", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "expiry", type: "uint256" },
      { name: "allowed", type: "bool" },
    ],
  };
  const value = { holder, spender, nonce, expiry, allowed };
  const hash = utils._TypedDataEncoder.hash(domain, types, value);
  return utils.arrayify(hash);
}
