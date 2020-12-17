import { ethers } from "hardhat";
import { deployGovernance } from "../src/deploy";

describe("Governance", function () {
  it("should deploy without errors", async function () {
    const [owner] = await ethers.getSigners();
    await deployGovernance(owner);
  });
});
