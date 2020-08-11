import * as Ethers from "ethers";
import buidler from "@nomiclabs/buidler";

import {
  TestTokenFactory,
  RadFactory,
  RadicleRegistryFactory,
} from "../ethers-contracts";
import {Rad} from "../ethers-contracts/Rad";
import {TestToken} from "../ethers-contracts/TestToken";
import {RadicleRegistry} from "../ethers-contracts/RadicleRegistry";

export interface TestEnvironment {
  user: (signer: Ethers.Signer) => Promise<User>;
  root: User;
}

export interface User {
  address: string;
  dai: TestToken;
  rad: Rad;
  registry: RadicleRegistry;
}

export async function setupTestEnvironment(): Promise<TestEnvironment> {
  const [signer] = await buidler.ethers.getSigners();
  const address = await signer.getAddress();

  const dai = await new TestTokenFactory(signer).deploy("Dai", 1e12);
  const rad = await new RadFactory(signer).deploy(1e12);

  const registry = await new RadicleRegistryFactory(signer).deploy(
    rad.address,
    dai.address
  );

  return {
    user: async (signer: Ethers.Signer) => {
      return {
        address: await signer.getAddress(),
        dai: dai.connect(signer),
        rad: rad.connect(signer),
        registry: registry.connect(signer),
      };
    },
    root: {
      address,
      dai,
      rad,
      registry,
    },
  };
}

export async function wait(
  response: Promise<Ethers.ContractTransaction>
): Promise<Ethers.ContractReceipt> {
  return (await response).wait();
}

// buidler does not provide proper type definitions for the `ethers`
// plugin.
declare module "@nomiclabs/buidler/types" {
  interface BuidlerRuntimeEnvironment {
    ethers: {
      provider: Ethers.providers.JsonRpcProvider;
      getSigners(): Ethers.Signer[];
    };
  }
}
