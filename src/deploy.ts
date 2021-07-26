import assert from "assert";
import {
  constants,
  providers,
  utils,
  BigNumberish,
  BaseContract,
  ContractReceipt,
  Signer,
} from "ethers";
import { Claims } from "../contract-bindings/ethers/Claims";
import { ClaimsV2 } from "../contract-bindings/ethers/ClaimsV2";
import { Dai } from "../contract-bindings/ethers/Dai";
import { DaiPool } from "../contract-bindings/ethers/DaiPool";
import { ENS } from "../contract-bindings/ethers/ENS";
import { EthPool } from "../contract-bindings/ethers/EthPool";
import { Governor } from "../contract-bindings/ethers/Governor";
import { Phase0 } from "../contract-bindings/ethers/Phase0";
import { RadicleToken } from "../contract-bindings/ethers/RadicleToken";
import { Registrar } from "../contract-bindings/ethers/Registrar";
import { Timelock } from "../contract-bindings/ethers/Timelock";
import { VestingToken } from "../contract-bindings/ethers/VestingToken";
import {
  BaseRegistrarImplementation__factory,
  Claims__factory,
  ClaimsV2__factory,
  Dai__factory,
  DaiPool__factory,
  ENSRegistry__factory,
  Erc20Pool__factory,
  Erc20Pool,
  EthPool__factory,
  Governor__factory,
  IERC20__factory,
  IERC721__factory,
  Phase0__factory,
  RadicleToken__factory,
  Registrar__factory,
  Timelock__factory,
  VestingToken__factory,
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
  dai: Dai;
  registrar: Registrar;
  ens: ENS;
  ethPool: EthPool;
  erc20Pool: Erc20Pool;
  daiPool: DaiPool;
  claims: Claims;
}

export async function deployAll(signer: Signer): Promise<DeployedContracts> {
  const signerAddr = await signer.getAddress();
  const rad = await deployRadicleToken(signer, signerAddr);
  const dai = await deployTestDai(signer);
  const timelock = await deployTimelock(signer, signerAddr, 2 * 60 * 60 * 24);
  const gov = await deployGovernance(signer, timelock.address, rad.address, signerAddr);
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
  const daiPool = await deployDaiPool(signer, 10, dai.address);
  const claims = await deployClaims(signer);

  return { gov, rad, dai, registrar, ens, ethPool, erc20Pool, daiPool, claims };
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

export async function deployEthPool(signer: Signer, cycleSecs: number): Promise<EthPool> {
  return deployOk(new EthPool__factory(signer).deploy(cycleSecs));
}

export async function deployErc20Pool(
  signer: Signer,
  cycleSecs: number,
  erc20TokenAddress: string
): Promise<Erc20Pool> {
  return deployOk(new Erc20Pool__factory(signer).deploy(cycleSecs, erc20TokenAddress));
}

export async function deployDaiPool(
  signer: Signer,
  cycleSecs: number,
  daiAddress: string
): Promise<DaiPool> {
  return deployOk(new DaiPool__factory(signer).deploy(cycleSecs, daiAddress));
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
  monadicAddr: string,
  foundationAddr: string,
  timelockDelay: number,
  governorGuardian: string,
  ensAddr: string,
  ethLabel: string
): Promise<Phase0> {
  return deployOk(
    new Phase0__factory(signer).deploy(
      monadicAddr,
      foundationAddr,
      timelockDelay,
      governorGuardian,
      ensAddr,
      utils.namehash(ethLabel + ".eth"),
      ethLabel,
      { gasLimit: 10 * 10 ** 6 }
    )
  );
}

export async function deployClaims(signer: Signer): Promise<Claims> {
  return deployOk(new Claims__factory(signer).deploy());
}

export async function deployClaimsV2(signer: Signer): Promise<ClaimsV2> {
  return deployOk(new ClaimsV2__factory(signer).deploy());
}

export async function deployTestDai(signer: Signer): Promise<Dai> {
  return deployOk(new Dai__factory(signer).deploy());
}

async function deployOk<T extends BaseContract>(contractPromise: Promise<T>): Promise<T> {
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
