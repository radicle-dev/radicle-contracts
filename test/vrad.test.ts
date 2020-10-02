import buidler from "@nomiclabs/buidler";
import {assert} from "chai";
import {submit, elapseTime} from "./support";

import {VRadFactory, RadFactory} from "../contract-bindings/ethers";

describe("VRad", function () {
  it("is a vesting token", async function () {
    const [
      owner,
      grantor,
      grantee,
      treasury,
    ] = await buidler.ethers.getSigners();
    const grantorAddress = await grantor.getAddress();
    const treasuryAddress = await treasury.getAddress();
    const granteeAddress = await grantee.getAddress();

    const rad = await new RadFactory(owner).deploy(treasuryAddress, 100);
    const vrad = await new VRadFactory(owner).deploy(
      rad.address,
      grantorAddress
    );

    // Treasury balance is greater than zero.
    assert((await rad.balanceOf(treasuryAddress)).gt(0));

    // Approve the treasury to transfer Rad to the contract.
    await submit(rad.connect(treasury).approve(vrad.address, 100));

    // Check allowance.
    assert.equal(
      (await rad.allowance(treasuryAddress, vrad.address)).toNumber(),
      100
    );

    // Expand token supply.
    await submit(vrad.connect(treasury).depositRadFrom(treasuryAddress, 70));

    // Since the grantee hasn't been granted anything, he should have zero allocation.
    assert.equal((await vrad.vestedBalanceOf(granteeAddress)).toNumber(), 0);

    // Get the current (block) time.
    const now = await vrad.getTime();
    // Cliff duration (1 day)
    const vestingCliff = 60 * 60 * 24;
    // Total vesting duration (1 week)
    const vestingTotal = vestingCliff * 7;

    // Grant some tokens to the grantee.
    await submit(
      vrad.connect(grantor).grantTokens(
        granteeAddress,
        70, // 10 Rad (smallest denomination)
        now, // Start time of vesting
        vestingCliff,
        vestingTotal
      )
    );

    // The grantee should now have tokens vesting.
    assert.equal((await vrad.vestingBalanceOf(granteeAddress)).toNumber(), 70);
    // ... but nothing vested yet.
    assert.equal((await vrad.vestedBalanceOf(granteeAddress)).toNumber(), 0);

    // Advance time by half the cliff period.
    await elapseTime(vestingCliff / 2);

    // Since we're still within the cliff, nothing is vested.
    assert.equal((await vrad.vestedBalanceOf(granteeAddress)).toNumber(), 0);

    // Advance time until the cliff is passed.
    await elapseTime(vestingCliff / 2);

    // Cliff is passed, we vested 1/7.
    assert.equal((await vrad.vestedBalanceOf(granteeAddress)).toNumber(), 10);

    // Redeem our vested tokens.
    await submit(vrad.connect(grantee).redeemVestedTokens(granteeAddress, 10));

    // Grantee Rad balance is 1/7 of vested.
    assert((await rad.balanceOf(granteeAddress)).eq(10));
  });
});
