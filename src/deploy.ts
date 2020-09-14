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
  FixedWindowOracleFactory,
  StablePriceOracleFactory,
} from "../ethers-contracts";
import * as ensUtils from "./ens";

import UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";
import UniswapV2Router02 from "@uniswap/v2-periphery/build/UniswapV2Router02.json";
import ERC20 from "@uniswap/v2-periphery/build/ERC20.json";
import WETH9 from "@uniswap/v2-periphery/build/WETH9.json";
import IUniswapV2Pair from "@uniswap/v2-core/build/IUniswapV2Pair.json";
import ENSRegistry from "@ensdomains/ens/build/contracts/ENSRegistry.json";

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

export async function deployAll<P extends ethers.providers.Provider>(
  provider: P,
  signer: ethers.Signer
): Promise<DeployedContracts> {
  const rad = await deployRad(provider, signer);
  const exchange = await deployExchange(rad, provider, signer);
  const ens = (await deployContract(signer, ENSRegistry, [])) as Ens;
  const registrar = await deployRegistrar(exchange, ens, provider, signer);

  return {rad, exchange, registrar, ens};
}

export async function deployRad<P extends ethers.providers.Provider>(
  _provider: P,
  signer: ethers.Signer
): Promise<Rad> {
  const signerAddr = await signer.getAddress();
  const radToken = await new RadFactory(signer).deploy(
    signerAddr,
    toDecimals(10000, 18)
  );

  return radToken;
}

export async function deployRegistrar<P extends ethers.providers.Provider>(
  exchange: Exchange,
  ens: Ens,
  _provider: P,
  signer: ethers.Signer
): Promise<Registrar> {
  const signerAddr = await signer.getAddress();
  const oracle = await exchange.oracle();
  const rad = await exchange.rad();
  const registrar = await new RegistrarFactory(signer).deploy(
    ens.address,
    ensUtils.nameHash("radicle.eth"),
    oracle,
    exchange.address,
    rad
  );

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

  return registrar;
}

export async function deployExchange<P extends ethers.providers.Provider>(
  radToken: Rad,
  provider: P,
  signer: ethers.Signer
): Promise<Exchange> {
  const signerAddr = await signer.getAddress();

  // Deploy tokens
  const usdToken = await deployContract(signer, ERC20, [toDecimals(10000, 18)]);
  const wethToken = await deployContract(signer, WETH9, []);

  // Deposit ETH into WETH contract
  await submitOk(
    wethToken.connect(signer).deposit({value: toDecimals(100, 18)})
  );

  // Deploy Uniswap factory & router
  const factory = await deployContract(signer, UniswapV2Factory, [signerAddr]);
  const router = await deployContract(signer, UniswapV2Router02, [
    factory.address,
    wethToken.address,
  ]);

  /////////////////////////////////////////////////////////////////////////////

  // Create USD/WETH pair
  await factory.createPair(usdToken.address, wethToken.address);
  const usdWethAddr = await factory.getPair(
    usdToken.address,
    wethToken.address
  );
  const usdWethPair = new ethers.Contract(
    usdWethAddr,
    JSON.stringify(IUniswapV2Pair.abi),
    provider
  ).connect(signer);

  // Transfer USD into the WETH/RAD pair.
  await usdToken.transfer(usdWethAddr, toDecimals(10, 18));

  // Transfer WETH into the USD/WETH pair.
  await wethToken.connect(signer).transfer(usdWethAddr, toDecimals(10, 18));
  await submitOk(usdWethPair.sync());

  /////////////////////////////////////////////////////////////////////////////

  // Create WETH/RAD pair
  await factory.createPair(wethToken.address, radToken.address);
  const wethRadAddr = await factory.getPair(
    wethToken.address,
    radToken.address
  );
  const wethRadPair = new ethers.Contract(
    wethRadAddr,
    JSON.stringify(IUniswapV2Pair.abi),
    provider
  ).connect(signer);

  // Transfer RAD into the WETH/RAD pair.
  await radToken.transfer(wethRadAddr, toDecimals(10, 18));

  // Transfer WETH into the WETH/RAD pair.
  await wethToken.connect(signer).transfer(wethRadAddr, toDecimals(10, 18));
  await submitOk(wethRadPair.sync());

  /////////////////////////////////////////////////////////////////////////////

  // Deploy price oracle
  const fixedWindowOracle = await new FixedWindowOracleFactory(signer).deploy(
    factory.address,
    usdToken.address,
    wethToken.address
  );
  const oracle = await new StablePriceOracleFactory(signer).deploy(
    fixedWindowOracle.address
  );

  const exchange = await new ExchangeFactory(signer).deploy(
    radToken.address,
    router.address,
    oracle.address
  );

  return exchange;
}

async function submitOk(
  tx: Promise<ethers.ContractTransaction>
): Promise<ethers.ContractReceipt> {
  const receipt = await (await tx).wait();
  assert.equal(receipt.status, 1, "transaction must be successful");

  return receipt;
}

const deployContract = async (
  signer: ethers.Signer,
  contractJSON: any,
  args: Array<any>
) => {
  const factory = new ethers.ContractFactory(
    contractJSON.abi,
    contractJSON.bytecode,
    signer
  );
  return factory.deploy(...args);
};

function toDecimals(n: number, exp: number): ethers.BigNumber {
  return ethers.BigNumber.from(n).mul(ethers.BigNumber.from(10).pow(exp));
}
