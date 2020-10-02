import {ethers} from "@nomiclabs/buidler";
import {assert} from "chai";
import {submit} from "./support";
import {AttestationRegistryFactory} from "../contract-bindings/ethers";

describe("Attestations", function () {
  it("should allow attestations to be made and revoked", async function () {
    const [signer] = await ethers.getSigners();
    const address = await signer.getAddress();
    const attestationRegistry = await new AttestationRegistryFactory(
      signer
    ).deploy();
    await attestationRegistry.deployed();

    const id = ethers.utils.randomBytes(32);
    const rev = ethers.utils.randomBytes(32);
    const pk = ethers.utils.randomBytes(32);
    const sig = new Array(64).fill(0);

    await submit(attestationRegistry.attest(id, rev, pk, sig));

    const attestation = await attestationRegistry.attestations(address);
    assert.equal(attestation.id, ethers.utils.hexlify(id));

    await submit(attestationRegistry.revokeAttestation());
    const revoked = await attestationRegistry.attestations(address);
    assert.equal(
      ethers.utils.hexlify(revoked.id),
      "0x0000000000000000000000000000000000000000000000000000000000000000"
    );
  });
});
