import { RadicleToken } from "../contract-bindings/ethers/RadicleToken";
import { ethers } from "hardhat";
import {
  constants,
  utils,
  BytesLike,
  BigNumber,
  BigNumberish,
  Signature,
} from "ethers";
import { expect } from "chai";
import {
  expectBigNumberEq,
  expectTxFail,
  getSigningKey,
  submit,
  submitFailing,
} from "./support";
import { deployRadicleToken } from "../src/deploy";

async function getRadicleTokenSigners(): Promise<RadicleToken[]> {
  const signers = await ethers.getSigners();
  const token = await deployRadicleToken(signers[0], await signers[0].getAddress());
  return signers.map((signer) => token.connect(signer));
}

async function signDelegation(
  delegator: RadicleToken,
  delegatee: RadicleToken,
  nonce: number,
  expiry: number
): Promise<Signature> {
  const domain = {
    name: "Radicle",
    chainId: await delegator.signer.getChainId(),
    verifyingContract: delegator.address,
  };
  const types = {
    Delegation: [
      { name: "delegatee", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "expiry", type: "uint256" },
    ],
  };
  const delegateeAddr = await delegatee.signer.getAddress();
  const value = { delegatee: delegateeAddr, nonce: nonce, expiry: expiry };
  const digest = utils._TypedDataEncoder.hash(domain, types, value);
  const delegatorAddr = await delegator.signer.getAddress();
  return getSigningKey(delegatorAddr).signDigest(digest);
}

async function expectDelegateBySigFail(
  delegator: RadicleToken,
  delegatee: RadicleToken,
  nonce: BigNumberish,
  expiry: BigNumberish,
  v: BigNumberish,
  r: BytesLike,
  s: BytesLike,
  expectedCause: string
): Promise<void> {
  const addr = await delegatee.signer.getAddress();
  await submitFailing(
    delegator.delegateBySig(addr, nonce, expiry, v, r, s),
    "delegateBySig",
    "RadicleToken::delegateBySig: " + expectedCause
  );
}

async function expectDelegation(token: RadicleToken, expectedDelegation: string): Promise<void> {
  const address = await token.signer.getAddress();
  const actualDelegation = await token.delegates(address);
  expect(actualDelegation).to.equal(expectedDelegation, "Invalid delegation");
}

async function expectPriorVotes(
  token: RadicleToken,
  blockNumber: number,
  expected: BigNumberish
): Promise<void> {
  const addr = await token.signer.getAddress();
  const actual = await token.getPriorVotes(addr, blockNumber);
  expectBigNumberEq(actual, expected, "Invalid number of votes");
}

describe("Radicle Token", () => {
  describe("metadata", () => {
    it("has given name", async () => {
      const [token] = await getRadicleTokenSigners();
      expect(await token.name()).to.equal("Radicle");
    });

    it("has given symbol", async () => {
      const [token] = await getRadicleTokenSigners();
      expect(await token.symbol()).to.equal("RAD");
    });
  });

  describe("balanceOf", () => {
    it("grants to initial account", async () => {
      const [token] = await getRadicleTokenSigners();
      const owner = await token.signer.getAddress();
      expectBigNumberEq(
        await token.balanceOf(owner),
        BigNumber.from(10).pow(8 + 18),
        "Invalid initial balance"
      );
    });
  });

  describe("delegateBySig", () => {
    it("reverts if the signatory is invalid", async () => {
      const [delegator, delegatee] = await getRadicleTokenSigners();
      await expectDelegateBySigFail(
        delegator,
        delegatee,
        0,
        10e9,
        0,
        utils.randomBytes(32),
        utils.randomBytes(32),
        "invalid signature"
      );
    });

    it("reverts if the nonce is bad ", async () => {
      const [delegator, delegatee] = await getRadicleTokenSigners();
      const nonce = 1;
      const expiry = 10e9;
      const { v, r, s } = await signDelegation(delegator, delegatee, nonce, expiry);
      await expectDelegateBySigFail(delegator, delegatee, nonce, expiry, v, r, s, "invalid nonce");
    });

    it("reverts if the signature has expired", async () => {
      const [delegator, delegatee] = await getRadicleTokenSigners();
      const nonce = 0;
      const expiry = 0;
      const { v, r, s } = await signDelegation(delegator, delegatee, nonce, expiry);

      await expectDelegateBySigFail(
        delegator,
        delegatee,
        nonce,
        expiry,
        v,
        r,
        s,
        "signature expired"
      );
    });

    it("delegates on behalf of the signatory", async () => {
      const [delegator, delegatee] = await getRadicleTokenSigners();
      const delegateeAddr = await delegatee.signer.getAddress();
      const nonce = 0;
      const expiry = 10e9;
      const { v, r, s } = await signDelegation(delegator, delegatee, nonce, expiry);

      await expectDelegation(delegator, constants.AddressZero);
      await submit(delegatee.delegateBySig(delegateeAddr, nonce, expiry, v, r, s), "delegateBySig");
      await expectDelegation(delegator, delegateeAddr);
    });
  });

  describe("numCheckpoints", () => {
    it("does not add more than one checkpoint in a block", async () => {
      // TODO depends on https://github.com/nomiclabs/hardhat/issues/1214
    });
  });

  describe("getPriorVotes", () => {
    it("reverts if block number >= current block", async () => {
      const [user] = await getRadicleTokenSigners();
      const userAddr = await user.signer.getAddress();
      await expectTxFail(
        user.getPriorVotes(userAddr, 10e9),
        "getPriorVotes",
        "RadicleToken::getPriorVotes: not yet determined"
      );
    });

    it("returns 0 if there are no checkpoints", async () => {
      const [user] = await getRadicleTokenSigners();
      await expectPriorVotes(user, 0, 0);
    });
  });
});
