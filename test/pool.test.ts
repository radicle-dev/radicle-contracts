import {PoolFactory} from "../ethers-contracts";
// import {Pool} from "../ethers-contracts/Pool";
import buidler from "@nomiclabs/buidler";

import {assert} from "chai";

async function deployPool() {
  const [signer] = await buidler.ethers.getSigners();
  return new PoolFactory(signer).deploy().then((pool) => pool.deployed());
}

describe("Pool", function () {
  it("rejects withdrawal from an empty account", async function () {
    const pool = await deployPool();
    await pool
      .withdraw(1)
      .then(() => assert.fail())
      .catch((error) =>
        assert(error.message.endsWith("Not enough funds in account"))
      );
  });

  it("allows withdrawal from an account up to its value", async function () {
    const pool = await deployPool();
    await pool.topUp({value: 100});
    await pool.withdraw(99);
    await pool.withdraw(1);
  });

  it("rejects withdrawal from an account over its value", async function () {
    const pool = await deployPool();
    await pool.topUp({value: 100});
    await pool
      .withdraw(101)
      .then(() => assert.fail())
      .catch((error) =>
        assert(error.message.endsWith("Not enough funds in account"))
      );
  });
});
