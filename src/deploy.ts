import assert from "assert";
import * as ethers from "ethers";

import {Registrar} from "../ethers-contracts/Registrar";
import {Rad} from "../ethers-contracts/Rad";
import {Ens} from "../ethers-contracts/Ens";
import {Exchange} from "../ethers-contracts/Exchange";
import {
  DummyPriceOracleFactory,
  DummyEnsRegistryFactory,
  RadFactory,
  DummyRouterFactory,
  ExchangeFactory,
  RegistrarFactory,
} from "../ethers-contracts";
import * as ensUtils from "./ens";

export interface DeployedContracts {
  registrar: Registrar;
  exchange: Exchange;
  rad: Rad;
  ens: Ens;
}

// Deploy development contract infrastructure.
export async function deployDev(
  signer: ethers.Signer
): Promise<DeployedContracts> {
  const signerAddr = await signer.getAddress();

  const oracle = await new DummyPriceOracleFactory(signer).deploy(1);

  const ens = await new DummyEnsRegistryFactory(signer).deploy();

  const rad = await new RadFactory(signer).deploy(signerAddr, 1e6);

  const router = await new DummyRouterFactory(signer).deploy(rad.address);

  const exchange = await new ExchangeFactory(signer).deploy(
    rad.address,
    router.address,
    oracle.address
  );

  const registrar = await new RegistrarFactory(signer).deploy(
    ens.address,
    ensUtils.nameHash("radicle.eth"),
    oracle.address,
    exchange.address,
    rad.address
  );
  await registrar.deployed();

  await oracle.deployed();
  await ens.deployed();
  await rad.deployed();
  await router.deployed();
  await exchange.deployed();

  await (await rad.connect(signer).transfer(router.address, 1e3)).wait();

  await submitOk(
    ens.setSubnodeOwner(
      ensUtils.nameHash(""),
      ensUtils.labelHash("eth"),
      signerAddr
    )
  );

  await submitOk(
    ens.setSubnodeOwner(
      ensUtils.nameHash("eth"),
      ensUtils.labelHash("radicle"),
      registrar.address
    )
  );

  return {
    registrar,
    exchange,
    rad,
    ens,
  };
}

async function submitOk(
  tx: Promise<ethers.ContractTransaction>
): Promise<ethers.ContractReceipt> {
  const receipt = await (await tx).wait();
  assert.equal(receipt.status, 1, "transaction must be successful");

  return receipt;
}
