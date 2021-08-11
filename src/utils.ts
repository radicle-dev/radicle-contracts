import { utils, BigNumberish } from "ethers";
import { question } from "readline-sync";
import { Governor__factory } from "../contract-bindings/ethers";
import * as fs from "fs";

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

export function encodeGovernorProposal(): void {
  const calldata = loadGovernorProposal();
  console.log("Governor proposal calldata:\n" + calldata);
}

export function encodeProxyCommands(): void {
  const calldata = loadGovernorProposal();
  // Proxy commands are encoded like governor proposals minus the 4-byte selector
  const data = utils.hexDataSlice(calldata, 4);
  console.log("Encoded proxy commands:\n" + data);
}

function loadGovernorProposal(): string {
  interface Proposal {
    description: string;
    transactions: Array<{
      target: string;
      value: string | number | undefined;
      signature: string;
      args: unknown[] | undefined;
    }>;
  }
  const proposalPath = question(`Enter a file with JSON-encoded proposal in format
{
  "description": "string, a proposal description",
  "transactions": [
    {
      "target": "hex string, an address receiving the transaction",
      "value": "string or number, the value to send in the transaction, optional",
      "signature": "string, the called function signature to add to 'calldata', optional",
      "args": [
        "the called function arguments, optional, ignored if no signature is provided"
      ]
    }
  ]
}
`);
  const proposalJson = fs.readFileSync(proposalPath).toString();
  const proposal = JSON.parse(proposalJson) as Proposal;
  const targets = [];
  const values = [];
  const signatures = [];
  const calldatas = [];
  for (const { target, value, signature, args } of proposal.transactions) {
    targets.push(target);
    values.push(value ? value : 0);
    if (signature) {
      const fragment = utils.FunctionFragment.from(signature);
      const argsArray = args ? args : [];
      const argsEncoded = utils.defaultAbiCoder.encode(fragment.inputs, argsArray);
      signatures.push(fragment.format());
      calldatas.push(argsEncoded);
    } else {
      signatures.push("");
      calldatas.push("0x");
    }
  }
  const args = [targets, values, signatures, calldatas, proposal.description];
  return new Governor__factory().interface.encodeFunctionData("propose", args);
}
