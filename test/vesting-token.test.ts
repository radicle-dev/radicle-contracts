import { ethers } from "hardhat";
import { expectBigNumberEq, submit, nextDeployedContractAddr } from "./support";
import { deployVestingToken, deployRadicleToken } from "../src/deploy";

describe("Vesting token", function () {
  it("gives funds", async function () {
    const [admin, beneficiary] = await ethers.getSigners();
    const adminAddr = await admin.getAddress();
    const beneficiaryAddr = await beneficiary.getAddress();
    const token = await deployRadicleToken(admin, adminAddr);
    const vestedAmt = 100;
    const vestingAddr = await nextDeployedContractAddr(admin, 1);
    await submit(token.approve(vestingAddr, vestedAmt), "approve");
    const vesting = await deployVestingToken(
      admin,
      token.address,
      adminAddr,
      beneficiaryAddr,
      vestedAmt,
      200,
      300,
      400
    );
    await submit(
      vesting.connect(beneficiary).withdrawVested(),
      "withdrawVested"
    );
    const balance = await token.balanceOf(beneficiaryAddr);
    expectBigNumberEq(balance, vestedAmt, "Invalid amount gained from vesting");
  });
});
