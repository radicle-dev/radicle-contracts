/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import assert from "assert";
import * as ethers from "ethers";
import * as abi from "@ethersproject/abi";

import { Registrar } from "../contract-bindings/ethers/Registrar";
import { Rad } from "../contract-bindings/ethers/Rad";
import { ENS } from "../contract-bindings/ethers/ENS";
import { Exchange } from "../contract-bindings/ethers/Exchange";
import { EthPool } from "../contract-bindings/ethers/EthPool";
import { Governor } from "../contract-bindings/ethers/Governor";
import { RadicleToken } from "../contract-bindings/ethers/RadicleToken";
import {
  Governor__factory,
  RadicleToken__factory,
  Timelock__factory,
  Rad__factory,
  Exchange__factory,
  EthPool__factory,
  Erc20Pool__factory,
  FixedWindowOracle__factory,
  Registrar__factory,
  StablePriceOracle__factory,
  Erc20Pool,
} from "../contract-bindings/ethers";
import * as ensUtils from "./ens";

import UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";
import UniswapV2Router02 from "@uniswap/v2-periphery/build/UniswapV2Router02.json";
import ERC20 from "@uniswap/v2-periphery/build/ERC20.json";
import WETH9 from "@uniswap/v2-periphery/build/WETH9.json";
import IUniswapV2Pair from "@uniswap/v2-core/build/IUniswapV2Pair.json";
import ENSRegistry from "@ensdomains/ens/build/contracts/ENSRegistry.json";

export interface DeployedGovernance {
  token: RadicleToken;
  governor: Governor;
}

export interface DeployedContracts {
  gov: DeployedGovernance;
  rad: Rad;
  registrar: Registrar;
  exchange: Exchange;
  ens: ENS;
  ethPool: EthPool;
  erc20Pool: Erc20Pool;
}

export async function deployAll(
  signer: ethers.Signer
): Promise<DeployedContracts> {
  const gov = await deployGovernance(signer);
  const rad = await deployRad(signer);
  const exchange = await deployExchange(rad, signer);
  const ens = (await deployContract(signer, ENSRegistry, [])) as ENS;
  const registrar = await deployRegistrar(exchange, ens, signer);
  const ethPool = await deployEthPool(signer, 10);
  const erc20Pool = await deployErc20Pool(signer, 10, rad.address);

  return { gov, rad, exchange, registrar, ens, ethPool, erc20Pool };
}

export async function deployRad(signer: ethers.Signer): Promise<Rad> {
  const signerAddr = await signer.getAddress();
  const radToken = await new Rad__factory(signer).deploy(
    signerAddr,
    toDecimals(10000, 18)
  );

  return radToken;
}

export async function deployRegistrar(
  exchange: Exchange,
  ens: ENS,
  signer: ethers.Signer
): Promise<Registrar> {
  const signerAddr = await signer.getAddress();
  const oracle = await exchange.oracle();
  const rad = await exchange.rad();
  const registrar = await new Registrar__factory(signer).deploy(
    ens.address,
    ensUtils.nameHash("eth"),
    ensUtils.labelHash("radicle"),
    oracle,
    exchange.address,
    rad,
    signerAddr
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

export async function deployGovernance(
  signer: ethers.Signer
): Promise<DeployedGovernance> {
  const signerAddr = await signer.getAddress();

  const timelock = await new Timelock__factory(signer).deploy(
    signerAddr,
    2 * 60 * 60 * 24
  );
  const token = await new RadicleToken__factory(signer).deploy(signerAddr);
  const governor = await new Governor__factory(signer).deploy(
    timelock.address,
    token.address,
    signerAddr
  );

  return { governor, token };
}

export async function deployExchange(
  radToken: Rad,
  signer: ethers.Signer
): Promise<Exchange> {
  const signerAddr = await signer.getAddress();

  // Deploy tokens
  const usdToken = await deployContract(signer, ERC20, [toDecimals(10000, 18)]);
  const wethToken = await deployContract(signer, WETH9, []);

  // Deposit ETH into WETH contract
  await submitOk(wethToken.deposit({ value: toDecimals(100, 18) }));

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
    signer
  );

  // Transfer USD into the USD/WETH pair.
  await usdToken.transfer(usdWethAddr, toDecimals(10, 18));

  // Transfer WETH into the USD/WETH pair.
  await wethToken.transfer(usdWethAddr, toDecimals(10, 18));
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
    signer
  );

  // Transfer RAD into the WETH/RAD pair.
  await radToken.transfer(wethRadAddr, toDecimals(10, 18));

  // Transfer WETH into the WETH/RAD pair.
  await wethToken.transfer(wethRadAddr, toDecimals(10, 18));
  await submitOk(wethRadPair.sync());

  /////////////////////////////////////////////////////////////////////////////

  // Deploy price oracle
  const fixedWindowOracle = await new FixedWindowOracle__factory(signer).deploy(
    factory.address,
    usdToken.address,
    wethToken.address
  );
  const oracle = await new StablePriceOracle__factory(signer).deploy(
    fixedWindowOracle.address
  );

  const exchange = await new Exchange__factory(signer).deploy(
    radToken.address,
    router.address,
    oracle.address
  );

  return exchange;
}

export async function deployEthPool(
  signer: ethers.Signer,
  cycleBlocks: number
): Promise<EthPool> {
  return await new EthPool__factory(signer).deploy(cycleBlocks);
}

export async function deployErc20Pool(
  signer: ethers.Signer,
  cycleBlocks: number,
  erc20TokenAddress: string
): Promise<Erc20Pool> {
  return await new Erc20Pool__factory(signer).deploy(
    cycleBlocks,
    erc20TokenAddress
  );
}

async function submitOk(
  tx: Promise<ethers.ContractTransaction>
): Promise<ethers.ContractReceipt> {
  const receipt = await (await tx).wait();
  assert.strictEqual(receipt.status, 1, "transaction must be successful");

  return receipt;
}

interface CompilerOutput {
  abi: abi.JsonFragment[];
  bytecode: string;
}

async function deployContract(
  signer: ethers.Signer,
  compilerOutput: CompilerOutput,
  args: Array<unknown>
): Promise<ethers.Contract> {
  const factory = new ethers.ContractFactory(
    compilerOutput.abi,
    compilerOutput.bytecode,
    signer
  );
  return factory.deploy(...args);
}

function toDecimals(n: number, exp: number): ethers.BigNumber {
  return ethers.BigNumber.from(n).mul(ethers.BigNumber.from(10).pow(exp));
}
