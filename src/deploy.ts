import assert from "assert";
import {
  constants,
  providers,
  utils,
  BigNumber,
  BigNumberish,
  Contract,
  ContractReceipt,
  Signer,
} from "ethers";
import { ENS } from "../contract-bindings/ethers/ENS";
import { EthPool } from "../contract-bindings/ethers/EthPool";
import { Exchange } from "../contract-bindings/ethers/Exchange";
import { Governor } from "../contract-bindings/ethers/Governor";
import { Phase0 } from "../contract-bindings/ethers/Phase0";
import { Phase1 } from "../contract-bindings/ethers/Phase1";
import { RadicleToken } from "../contract-bindings/ethers/RadicleToken";
import { Registrar } from "../contract-bindings/ethers/Registrar";
import { Timelock } from "../contract-bindings/ethers/Timelock";
import { VestingToken } from "../contract-bindings/ethers/VestingToken";
import {
  BaseRegistrarImplementation__factory,
  ENSRegistry__factory,
  Erc20Pool__factory,
  Erc20Pool,
  EthPool__factory,
  Exchange__factory,
  FixedWindowOracle__factory,
  Governor__factory,
  IERC20__factory,
  IERC721__factory,
  Phase0__factory,
  Phase1__factory,
  RadicleToken__factory,
  Registrar__factory,
  StablePriceOracle__factory,
  Timelock__factory,
  UniswapV2Factory__factory,
  IUniswapV2Pair__factory,
  UniswapV2Router02__factory,
  VestingToken__factory,
  WETH9__factory,
} from "../contract-bindings/ethers";
import { labelHash } from "./ens";

export async function nextDeployedContractAddr(
  signer: Signer,
  afterTransactions: number
): Promise<string> {
  return utils.getContractAddress({
    from: await signer.getAddress(),
    nonce: (await signer.getTransactionCount()) + afterTransactions,
  });
}

export interface DeployedContracts {
  gov: Governor;
  rad: RadicleToken;
  registrar: Registrar;
  exchange: Exchange;
  ens: ENS;
  ethPool: EthPool;
  erc20Pool: Erc20Pool;
}

export async function deployAll(signer: Signer): Promise<DeployedContracts> {
  const signerAddr = await signer.getAddress();
  const rad = await deployRadicleToken(signer, signerAddr);
  const timelock = await deployTimelock(signer, signerAddr, 2 * 60 * 60 * 24);
  const gov = await deployGovernance(signer, timelock.address, rad.address, signerAddr);
  const exchange = await deployExchange(rad, signer);
  const label = "radicle";
  const minCommitmentAge = 50;
  const ens = await deployTestEns(signer, label);
  const registrar = await deployRegistrar(
    signer,
    ens.address,
    rad.address,
    signerAddr,
    label,
    minCommitmentAge
  );
  await transferEthDomain(ens, label, registrar.address);
  const ethPool = await deployEthPool(signer, 10);
  const erc20Pool = await deployErc20Pool(signer, 10, rad.address);

  return { gov, rad, exchange, registrar, ens, ethPool, erc20Pool };
}

export async function deployRadicleToken(signer: Signer, account: string): Promise<RadicleToken> {
  return deployOk(new RadicleToken__factory(signer).deploy(account));
}

export async function deployVestingToken(
  signer: Signer,
  tokenAddr: string,
  owner: string,
  beneficiary: string,
  amount: BigNumberish,
  vestingStartTime: BigNumberish,
  vestingPeriod: BigNumberish,
  cliffPeriod: BigNumberish
): Promise<VestingToken> {
  const token = IERC20__factory.connect(tokenAddr, signer);
  const vestingAddr = await nextDeployedContractAddr(signer, 1);
  await submitOk(token.approve(vestingAddr, amount));
  return deployOk(
    new VestingToken__factory(signer).deploy(
      tokenAddr,
      owner,
      beneficiary,
      amount,
      vestingStartTime,
      vestingPeriod,
      cliffPeriod
    )
  );
}

export async function deployRegistrar(
  signer: Signer,
  ensAddr: string,
  token: string,
  admin: string,
  label: string,
  minCommitmentAge: BigNumberish
): Promise<Registrar> {
  return await deployOk(
    new Registrar__factory(signer).deploy(
      ensAddr,
      token,
      admin,
      minCommitmentAge,
      utils.namehash(label + ".eth"),
      labelHash(label)
    )
  );
}

// The ENS signer must be the owner of the domain.
// The new owner becomes the registrant, owner and resolver of the domain.
export async function transferEthDomain(ens: ENS, label: string, newOwner: string): Promise<void> {
  const signerAddr = await ens.signer.getAddress();
  const ethNode = utils.namehash("eth");
  const ethRegistrarAddr = await ens.owner(ethNode);
  assert.notStrictEqual(ethRegistrarAddr, constants.AddressZero, "No eth registrar found on ENS");
  const labelNode = utils.namehash(label + ".eth");
  await submitOk(ens.setRecord(labelNode, newOwner, newOwner, 0));
  const tokenId = labelHash(label);
  const ethRegistrar = IERC721__factory.connect(ethRegistrarAddr, ens.signer);
  await submitOk(ethRegistrar.transferFrom(signerAddr, newOwner, tokenId));
}

export async function deployGovernance(
  signer: Signer,
  timelock: string,
  token: string,
  guardian: string
): Promise<Governor> {
  return deployOk(new Governor__factory(signer).deploy(timelock, token, guardian));
}

export async function deployTimelock(
  signer: Signer,
  admin: string,
  delay: BigNumberish
): Promise<Timelock> {
  return deployOk(new Timelock__factory(signer).deploy(admin, delay));
}

export async function deployExchange(radToken: RadicleToken, signer: Signer): Promise<Exchange> {
  const radDecimals = await radToken.decimals();
  const signerAddr = await signer.getAddress();

  // Deploy tokens
  // Any ERC20 token will be good
  const usdToken = await deployRadicleToken(signer, signerAddr);
  const usdDecimals = await usdToken.decimals();
  const wethToken = await deployOk(new WETH9__factory(signer).deploy());
  const wethDecimals = await wethToken.decimals();

  // Deposit ETH into WETH contract
  await submitOk(wethToken.deposit({ value: toDecimals(100, wethDecimals) }));

  // Deploy Uniswap factory & router
  const factory = await deployOk(new UniswapV2Factory__factory(signer).deploy(signerAddr));
  const router = await deployOk(
    new UniswapV2Router02__factory(signer).deploy(factory.address, wethToken.address)
  );

  /////////////////////////////////////////////////////////////////////////////

  // Create USD/WETH pair
  await factory.createPair(usdToken.address, wethToken.address);
  const usdWethAddr = await factory.getPair(usdToken.address, wethToken.address);
  const usdWethPair = IUniswapV2Pair__factory.connect(usdWethAddr, signer);

  // Transfer USD into the USD/WETH pair.
  await usdToken.transfer(usdWethAddr, toDecimals(10, usdDecimals));

  // Transfer WETH into the USD/WETH pair.
  await wethToken.transfer(usdWethAddr, toDecimals(10, wethDecimals));
  await submitOk(usdWethPair.sync());

  /////////////////////////////////////////////////////////////////////////////

  // Create WETH/RAD pair
  await factory.createPair(wethToken.address, radToken.address);
  const wethRadAddr = await factory.getPair(wethToken.address, radToken.address);
  const wethRadPair = IUniswapV2Pair__factory.connect(wethRadAddr, signer);

  // Transfer RAD into the WETH/RAD pair.
  await radToken.transfer(wethRadAddr, toDecimals(10, radDecimals));

  // Transfer WETH into the WETH/RAD pair.
  await wethToken.transfer(wethRadAddr, toDecimals(10, wethDecimals));
  await submitOk(wethRadPair.sync());

  /////////////////////////////////////////////////////////////////////////////

  // Deploy price oracle
  const fixedWindowOracle = await deployOk(
    new FixedWindowOracle__factory(signer).deploy(
      factory.address,
      usdToken.address,
      wethToken.address
    )
  );
  const oracle = await deployOk(
    new StablePriceOracle__factory(signer).deploy(fixedWindowOracle.address)
  );

  const exchange = await deployOk(
    new Exchange__factory(signer).deploy(radToken.address, router.address, oracle.address)
  );

  return exchange;
}

export async function deployEthPool(signer: Signer, cycleBlocks: number): Promise<EthPool> {
  return deployOk(new EthPool__factory(signer).deploy(cycleBlocks));
}

export async function deployErc20Pool(
  signer: Signer,
  cycleBlocks: number,
  erc20TokenAddress: string
): Promise<Erc20Pool> {
  return deployOk(new Erc20Pool__factory(signer).deploy(cycleBlocks, erc20TokenAddress));
}

// The signer becomes an owner of the '', 'eth' and '<label>.eth' domains,
// the owner of the root ENS and the owner and controller of the 'eth' registrar
export async function deployTestEns(signer: Signer, label: string): Promise<ENS> {
  const signerAddr = await signer.getAddress();
  const ens = await deployOk(new ENSRegistry__factory(signer).deploy());
  const ethRegistrar = await deployOk(
    new BaseRegistrarImplementation__factory(signer).deploy(ens.address, utils.namehash("eth"))
  );
  await submitOk(ens.setSubnodeOwner(utils.namehash(""), labelHash("eth"), ethRegistrar.address));
  await submitOk(ethRegistrar.addController(signerAddr));
  await submitOk(ethRegistrar.register(labelHash(label), signerAddr, 10 ** 10));
  return ens;
}

export async function deployPhase0(
  signer: Signer,
  tokensHolder: string,
  timelockDelay: number,
  governorGuardian: string,
  ensAddr: string,
  ethLabel: string
): Promise<Phase0> {
  return deployOk(
    new Phase0__factory(signer).deploy(
      tokensHolder,
      timelockDelay,
      governorGuardian,
      ensAddr,
      utils.namehash(ethLabel + ".eth"),
      ethLabel,
      { gasLimit: 8 * 10 ** 6 }
    )
  );
}

export async function deployPhase1(
  signer: Signer,
  bFactory: string,
  crpFactory: string,
  radAddr: string,
  usdcAddr: string,
  lpAddr: string,
): Promise<Phase1> {
  return deployOk(
    new Phase1__factory(signer).deploy(
      bFactory,
      crpFactory,
      radAddr,
      usdcAddr,
      lpAddr,
      { gasLimit: 8 * 10 ** 6 }
    )
  );
}

async function deployOk<T extends Contract>(contractPromise: Promise<T>): Promise<T> {
  const contract = await contractPromise;
  await contract.deployed();
  return contract;
}

export async function submitOk(
  tx: Promise<providers.TransactionResponse>
): Promise<ContractReceipt> {
  const receipt = await (await tx).wait();
  assert.strictEqual(receipt.status, 1, "transaction must be successful");
  return receipt;
}

function toDecimals(n: number, exp: number): BigNumber {
  return BigNumber.from(n).mul(BigNumber.from(10).pow(exp));
}
