import { ethers } from "hardhat";
import { deployGovernance, deployTimelock, deployRadicleToken } from "../src/deploy";

describe("Governance", function () {
  it("should deploy without errors", async function () {
    const [signer] = await ethers.getSigners();
    const signerAddr = signer.address;
    const timelock = await deployTimelock(signer, signerAddr, 2 * 60 * 60 * 24);
    const token = await deployRadicleToken(signer, signerAddr);
    await deployGovernance(signer, timelock.address, token.address, signerAddr);
  });
});
