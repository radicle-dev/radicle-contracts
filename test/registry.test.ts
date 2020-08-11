import {assert} from "chai";
import {wait, setupTestEnvironment} from "./support";

describe("RadicleRegistry", function () {
  it("registers a user", async function () {
    const {root} = await setupTestEnvironment();

    const linkId = Buffer.alloc(32, 1);
    await root.dai.approve(root.registry.address, 3e12);
    await wait(root.registry.registerUserDai("alice", linkId));

    const user = await root.registry.users("alice");
    assert.equal(user.addr, root.address);
    assert.equal(user.linkId.slice(2), linkId.toString("hex"));

    const userName = await root.registry.usersByLinkId(linkId);
    assert.equal(userName, "alice");
  });
});
