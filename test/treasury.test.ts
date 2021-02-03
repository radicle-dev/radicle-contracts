import { ethers } from "hardhat";
import { assert } from "chai";
import { submit, submitFailing } from "./support";
import { deployTreasury } from "../src/deploy";

describe("Treasury", function () {
  it("allows deposits and withdrawals", async function () {
    const [admin, founder, thief] = await ethers.getSigners();
    const adminAddress = await admin.getAddress();
    const founderAddress = await founder.getAddress();
    const treasury = await deployTreasury(admin, adminAddress);
    const treasuryAddress = treasury.address;
    const amount = ethers.utils.parseEther("10");

    await founder.sendTransaction({
      value: amount,
      to: treasuryAddress,
    });

    const founderBalance = await founder.getBalance();

    await submitFailing(treasury.connect(thief).withdraw(ethers.constants.AddressZero, amount));
    await submit(treasury.connect(admin).withdraw(founderAddress, amount));

    assert((await founder.getBalance()).eq(founderBalance.add(amount)));
  });
});
