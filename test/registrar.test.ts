// radicle.eth = 0x1e8e223921cb10fa256008149efd13dc5089bb252c6270e8be840a020e2e6416
// cloudhead.radicle.eth = 0x567c364804de7bbedb53f583e483f6b73513fd2f44299e281024e4719da0b332
// treehead.radicle.eth = 0x151be02f47af592d39e263c0a38443a2da15cdffcaf1e57ab2be0c047c88a4a1

import {ethers} from "@nomiclabs/buidler";

describe("Registrar", function () {
  it("should allow registration of names", async function () {
    var rootNode =
      "0x1e8e223921cb10fa256008149efd13dc5089bb252c6270e8be840a020e2e6416";

    const Oracle = await ethers.getContractFactory("DummyPriceOracle");
    const oracle = await Oracle.deploy(1);

    const ENS = await ethers.getContractFactory("DummyEnsRegistry");
    const ens = await ENS.deploy();

    const Registrar = await ethers.getContractFactory("Registrar");
    const registrar = await Registrar.deploy(
      ens.address,
      rootNode,
      oracle.address
    );

    oracle.deployed();
    ens.deployed();
    registrar.deployed();
  });
});
