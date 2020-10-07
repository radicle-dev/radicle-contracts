import {ethers} from "@nomiclabs/buidler";
import {assert, expect} from "chai";
import {submit} from "./support";
import {OrgFactory} from "../contract-bindings/ethers";

describe("Org", function () {
  it("should allow a project to be anchored", async function () {
    const [owner] = await ethers.getSigners();
    const ownerAddr = await owner.getAddress();

    const org = await new OrgFactory(owner).deploy(ownerAddr);

    await org.deployed();

    const id = ethers.utils.randomBytes(32);
    const rev = ethers.utils.randomBytes(32);
    const hash = ethers.utils.randomBytes(32);

    // Create a new anchor.

    assert.equal(await org.projectExists(id), false);

    await submit(org.connect(owner).anchorProject(id, rev, hash));

    assert.equal(await org.projectExists(id), true);

    let proj = await org.projects(id);

    assert.equal(proj.rev, ethers.utils.hexlify(rev));
    assert.equal(proj.hash, ethers.utils.hexlify(hash));

    // Update the anchor.

    const newHash = ethers.utils.randomBytes(32);
    await submit(org.connect(owner).anchorProject(id, rev, newHash));

    proj = await org.projects(id);

    assert.equal(proj.hash, ethers.utils.hexlify(newHash));

    // Remove the anchor.

    await submit(org.connect(owner).removeProject(id));
    assert.equal(await org.projectExists(id), false);
  });

  it("should allow removing a project even if it doesn't exist", async function () {
    const [owner] = await ethers.getSigners();
    const ownerAddr = await owner.getAddress();

    const org = await new OrgFactory(owner).deploy(ownerAddr);

    const id = ethers.utils.randomBytes(32);
    await submit(org.connect(owner).removeProject(id));
  });

  it("should only allow the org owner to anchor", async function () {
    const [owner, bob] = await ethers.getSigners();
    const ownerAddr = await owner.getAddress();

    const org = await new OrgFactory(owner).deploy(ownerAddr);

    await org.deployed();

    const id = ethers.utils.randomBytes(32);
    const rev = ethers.utils.randomBytes(32);
    const hash = ethers.utils.randomBytes(32);

    // Should revert!
    await submit(org.connect(bob).anchorProject(id, rev, hash))
      .then(() => expect.fail("Expected error"))
      .catch(() => {});

    // Ok
    await submit(org.connect(owner).anchorProject(id, rev, hash));

    // Should revert!
    await submit(org.connect(bob).removeProject(id))
      .then(() => expect.fail("Expected error"))
      .catch(() => {});
  });

  it("should allow ownership to change", async function () {
    const [owner, bob] = await ethers.getSigners();
    const ownerAddr = await owner.getAddress();
    const bobAddr = await bob.getAddress();

    const org = await new OrgFactory(owner).deploy(ownerAddr);

    // Should revert!
    await submit(org.connect(bob).setOwner(bobAddr))
      .then(() => expect.fail("Expected error"))
      .catch(() => {});

    // Ok
    await submit(org.connect(owner).setOwner(bobAddr));

    // Should revert!
    await submit(org.connect(owner).setOwner(ownerAddr))
      .then(() => expect.fail("Expected error"))
      .catch(() => {});

    // Ok
    await submit(org.connect(bob).setOwner(ownerAddr));
  });

  it("should allow multiple projects anchored under an org", async function () {
    const [owner] = await ethers.getSigners();
    const ownerAddr = await owner.getAddress();

    const org = await new OrgFactory(owner).deploy(ownerAddr);

    let ids = [];

    for (let i = 0; i < 3; i++) {
      const id = ethers.utils.randomBytes(32);
      const rev = ethers.utils.randomBytes(32);
      const hash = ethers.utils.randomBytes(32);

      await submit(org.connect(owner).anchorProject(id, rev, hash));

      ids.push(id);
    }

    for (let i = 0; i < ids.length; i++) {
      assert.equal(await org.projectExists(ids[i]), true);
    }
  });
});
