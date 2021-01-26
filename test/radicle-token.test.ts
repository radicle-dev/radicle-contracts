import { RadicleToken } from "../contract-bindings/ethers/RadicleToken";
import { ethers } from "hardhat";
import {
  constants,
  utils,
  BytesLike,
  BigNumber,
  BigNumberish,
  ContractReceipt,
  Signature,
} from "ethers";
import { expect } from "chai";
import {
  expectBigNumberEq,
  expectTxFail,
  mineBlocks,
  getSigningKey,
  submit,
  submitFailing,
} from "./support";
import { deployRadicleToken } from "../src/deploy";

async function getRadicleTokenSigners(): Promise<RadicleToken[]> {
  const signers = await ethers.getSigners();
  const token = await deployRadicleToken(
    signers[0],
    await signers[0].getAddress()
  );
  return signers.map((signer) => token.connect(signer));
}

async function transfer(
  from: RadicleToken,
  to: RadicleToken,
  amount: BigNumberish
): Promise<ContractReceipt> {
  const addr = await to.signer.getAddress();
  return submit(from.transfer(addr, amount), "transfer");
}

async function delegate(
  from: RadicleToken,
  to: RadicleToken
): Promise<ContractReceipt> {
  const addr = await to.signer.getAddress();
  return submit(from.delegate(addr), "delegate");
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

async function expectDelegation(
  token: RadicleToken,
  expectedDelegation: string
): Promise<void> {
  const address = await token.signer.getAddress();
  const actualDelegation = await token.delegates(address);
  expect(actualDelegation).to.equal(expectedDelegation, "Invalid delegation");
}

async function expectNumCheckpoint(
  token: RadicleToken,
  expected: number
): Promise<void> {
  const actual = await token.numCheckpoints(await token.signer.getAddress());
  expectBigNumberEq(actual, expected, "Invalid number of checkpoints");
}

async function expectCheckpoints(
  token: RadicleToken,
  expected: Array<[number, BigNumberish]>
): Promise<void> {
  await expectNumCheckpoint(token, expected.length);
  const addr = await token.signer.getAddress();
  for (const [i, [expectedBlock, expectedVotes]] of expected.entries()) {
    const [actualBlock, actualVotes] = await token.checkpoints(addr, i);
    expectBigNumberEq(
      actualBlock,
      expectedBlock,
      `Invalid block number for checkpoint ${i}`
    );
    expectBigNumberEq(
      actualVotes,
      expectedVotes,
      `Invalid number of votes for checkpoint ${i}`
    );
  }
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
      expect(await token.symbol()).to.equal("RADICLE");
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
      const { v, r, s } = await signDelegation(
        delegator,
        delegatee,
        nonce,
        expiry
      );
      await expectDelegateBySigFail(
        delegator,
        delegatee,
        nonce,
        expiry,
        v,
        r,
        s,
        "invalid nonce"
      );
    });

    it("reverts if the signature has expired", async () => {
      const [delegator, delegatee] = await getRadicleTokenSigners();
      const nonce = 0;
      const expiry = 0;
      const { v, r, s } = await signDelegation(
        delegator,
        delegatee,
        nonce,
        expiry
      );

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
      const { v, r, s } = await signDelegation(
        delegator,
        delegatee,
        nonce,
        expiry
      );

      await expectDelegation(delegator, constants.AddressZero);
      await submit(
        delegatee.delegateBySig(delegateeAddr, nonce, expiry, v, r, s),
        "delegateBySig"
      );
      await expectDelegation(delegator, delegateeAddr);
    });
  });

  describe("numCheckpoints", () => {
    it("returns the number of checkpoints for a delegate", async () => {
      const [root, owner, delegatee, user] = await getRadicleTokenSigners();

      await transfer(root, owner, 100);
      await expectNumCheckpoint(delegatee, 0);

      const receipt1 = await delegate(owner, delegatee);
      await expectNumCheckpoint(delegatee, 1);

      const receipt2 = await transfer(owner, user, 10);
      await expectNumCheckpoint(delegatee, 2);

      const receipt3 = await transfer(owner, user, 10);
      await expectNumCheckpoint(delegatee, 3);

      const receipt4 = await transfer(root, owner, 20);
      await expectNumCheckpoint(delegatee, 4);

      await expectCheckpoints(delegatee, [
        [receipt1.blockNumber, 100],
        [receipt2.blockNumber, 90],
        [receipt3.blockNumber, 80],
        [receipt4.blockNumber, 100],
      ]);
    });

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

    it("returns the latest block if >= last checkpoint block", async () => {
      const [root, owner, delegatee] = await getRadicleTokenSigners();
      await transfer(root, owner, 100);
      const receipt = await delegate(owner, delegatee);
      await mineBlocks(2);
      await expectPriorVotes(delegatee, receipt.blockNumber - 1, 0);
      await expectPriorVotes(delegatee, receipt.blockNumber + 0, 100);
      await expectPriorVotes(delegatee, receipt.blockNumber + 1, 100);
    });

    it("generally returns the voting balance at the appropriate checkpoint", async () => {
      const [root, owner, delegatee, user] = await getRadicleTokenSigners();
      await transfer(root, owner, 100);
      const receipt1 = await delegate(owner, delegatee);
      await mineBlocks(2);
      const receipt2 = await transfer(owner, user, 10);
      await mineBlocks(2);
      const receipt3 = await transfer(owner, user, 10);
      await mineBlocks(2);
      const receipt4 = await transfer(user, owner, 20);
      await mineBlocks(2);

      await expectPriorVotes(delegatee, receipt1.blockNumber - 1, 0);
      await expectPriorVotes(delegatee, receipt1.blockNumber + 0, 100);
      await expectPriorVotes(delegatee, receipt1.blockNumber + 1, 100);
      await expectPriorVotes(delegatee, receipt2.blockNumber + 0, 90);
      await expectPriorVotes(delegatee, receipt2.blockNumber + 1, 90);
      await expectPriorVotes(delegatee, receipt3.blockNumber + 0, 80);
      await expectPriorVotes(delegatee, receipt3.blockNumber + 1, 80);
      await expectPriorVotes(delegatee, receipt4.blockNumber + 0, 100);
      await expectPriorVotes(delegatee, receipt4.blockNumber + 1, 100);
    });
  });
});
