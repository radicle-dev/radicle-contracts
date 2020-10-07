import {ethers} from "@nomiclabs/buidler";
import {assert} from "chai";
import {submit} from "./support";
import {
  OrgFactory,
} from "../contract-bindings/ethers";

describe("Org", function () {
  it("should behave like an org", async function () {
    const [owner] = await ethers.getSigners();
    const ownerAddr = await owner.getAddress();

    const org = await new OrgFactory(owner).deploy(ownerAddr);

    await org.deployed();

    const acmeId = ethers.utils.randomBytes(32);
    const acmeRev = ethers.utils.randomBytes(32);
    const acmeHash = ethers.utils.randomBytes(32);

    await submit(org.connect(owner).anchorProject(acmeId, acmeRev, acmeHash));

    const proj = await org.projects(acmeId);

    assert.equal(proj.rev, ethers.utils.hexlify(acmeRev));
    assert.equal(proj.hash, ethers.utils.hexlify(acmeHash));
  });
});
