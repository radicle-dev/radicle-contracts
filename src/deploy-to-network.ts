import {
  deployClaims,
  deployClaimsV2,
  deployDaiPool,
  deployDummyGovernor,
  deployErc20Pool,
  deployEthPool,
  deployPolygonExiter,
  deployPolygonProxy,
  deployTestEns,
  deployVestingToken,
  deployPhase0,
} from "./deploy";
import { loadGovernorProposal } from "./utils";
import { BigNumber, Contract, Wallet, providers, utils } from "ethers";
import SigningKey = utils.SigningKey;
import { keyInSelect, keyInYNStrict, question } from "readline-sync";
import { ERC20__factory } from "../contract-bindings/ethers";

const INFURA_ID = "de5e2a8780c04964950e73b696d1bfb1";

export async function testEns(): Promise<void> {
  console.log("The deployer will become an owner of the '', 'eth' and '<domain>.eth' domains,");
  console.log("the owner of the root ENS and the owner and controller of the 'eth' registrar");
  const signer = await connectEthereumWallet();
  const label = askFor("an 'eth' subdomain to register");
  await deploy("ENS", () => deployTestEns(signer, label));
}

export async function phase0(): Promise<void> {
  const signer = await connectEthereumWallet();
  const governorGuardian = askForAddress("of the governor guardian");
  const monadicAddr = askForAddress("of Monadic");
  const foundationAddr = askForAddress("of the Foundation");
  const ensAddr = askForAddress("of the ENS");
  const ethLabel = askFor("an 'eth' subdomain on which the registrar should operate");
  const timelockDelay = 60 * 60 * 24 * 2;

  const phase0 = await deploy("phase0", () =>
    deployPhase0(
      signer,
      monadicAddr,
      foundationAddr,
      timelockDelay,
      governorGuardian,
      ensAddr,
      ethLabel
    )
  );

  printDeployed("Radicle Token", await phase0.token());
  printDeployed("Timelock", await phase0.timelock());
  printDeployed("Governor", await phase0.governor());
  printDeployed("Registrar", await phase0.registrar());
  console.log(`Remember to give the '${ethLabel}.eth' domain to the registrar`);
}

export async function vestingTokens(): Promise<void> {
  console.log("The deployer will be the one providing tokens for vesting");
  const signer = await connectEthereumWallet();
  const tokenAddr = askForAddress("of the Radicle token contract");
  const token = ERC20__factory.connect(tokenAddr, signer);
  const decimals = await token.decimals();
  const symbol = await token.symbol();
  const owner = askForAddress("of the vesting contracts admin");
  const vestingPeriod = askForDaysInSeconds("the vesting period");
  const cliffPeriod = askForDaysInSeconds("the cliff period");
  do {
    const beneficiary = askForAddress("of beneficiary");
    const amount = askForAmount("to vest", decimals, symbol);
    const vestingStartTime = askForTimestamp("of the vesting start");
    await deploy("vesting tokens", () =>
      deployVestingToken(
        signer,
        tokenAddr,
        owner,
        beneficiary,
        amount,
        vestingStartTime,
        vestingPeriod,
        cliffPeriod
      )
    );
    console.log(beneficiary, "has", amount.toString(), "tokens vesting");
  } while (askYesNo("Create another vesting?"));
}

export async function ethFundingPool(): Promise<void> {
  const signer = await connectEthereumWallet();
  const cycleSecs = askForNumber("the length of the funding cycle in seconds");
  await deploy("funding pool", () => deployEthPool(signer, cycleSecs));
}

export async function erc20FundingPool(): Promise<void> {
  const signer = await connectEthereumWallet();
  const tokenAddr = askForAddress("of the ERC-20 token to used in the funding pool");
  const cycleSecs = askForNumber("the length of the funding cycle in seconds");
  await deploy("funding pool", () => deployErc20Pool(signer, cycleSecs, tokenAddr));
}

export async function daiFundingPool(): Promise<void> {
  const signer = await connectEthereumWallet();
  const tokenAddr = askForAddress("of the DAI token to used in the funding pool");
  const cycleSecs = askForNumber("the length of the funding cycle in seconds");
  await deploy("funding pool", () => deployDaiPool(signer, cycleSecs, tokenAddr));
}

export async function claims(): Promise<void> {
  const signer = await connectEthereumWallet();
  await deploy("claims", () => deployClaims(signer));
}

export async function claimsV2(): Promise<void> {
  const signer = await connectEthereumWallet();
  await deploy("claimsV2", () => deployClaimsV2(signer));
}

export async function polygonProxy(): Promise<void> {
  const polygonSigner = await connectPolygonWallet();
  const ethereumSigner = await connectPolygonL1Wallet(polygonSigner);
  const polygonNonce = await polygonSigner.getTransactionCount();
  const ethereumNonce = await ethereumSigner.getTransactionCount();
  if ((await polygonSigner.getTransactionCount()) != (await ethereumSigner.getTransactionCount())) {
    throw `The account has different nonces on Polygon (${polygonNonce}) and on Ethereum (${ethereumNonce})`;
  }
  const ownerAddr = askForAddress("of the proxy owner on L1");
  const rootChainManagerAddr = askForAddress("of the Polygon root chain manager");
  const fxChildAddr = askForAddress("of the Polygon fx child");
  await deploy("Polygon exiter on L1", () =>
    deployPolygonExiter(ethereumSigner, ownerAddr, rootChainManagerAddr)
  );
  await deploy("Polygon proxy on L2", () =>
    deployPolygonProxy(polygonSigner, ownerAddr, fxChildAddr)
  );
}

export async function dummyGovernor(): Promise<void> {
  const signer = await connectEthereumWallet();
  const adminAddr = askForAddress("of the governor admin");
  await deploy("dummy governor", () => deployDummyGovernor(signer, adminAddr));
}

export async function proposal(): Promise<void> {
  const signer = await connectEthereumWallet();
  const governorAddr = askForAddress("of the governor");
  const data = loadGovernorProposal();
  const response = await signer.sendTransaction({ to: governorAddr, data });
  await response.wait();
  console.log("Success");
}

export async function createBurnProof(): Promise<void> {
  // const { MaticPOSClient } = require("@maticnetwork/maticjs");

  // // const polygonProvider = askForPolygonProvider();
  // // const network = await polygonProvider.getNetwork();
  // // const l1Provider = getPolygonL1Provider(network.chainId);

  // const matic = new MaticPOSClient({
  //   // maticProvider: new providers.Web3Provider(polygonProvider),
  //   // parentProvider: new providers.Web3Provider(l1Provider),
  // });
  // console.log(matic);
  // //const matic = new Matic({network:"mainnet", version: "v1"});
  // const ERC20_TRANSFER_EVENT_SIG =
  //   '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  // const proof = await matic.posRootChainManager.exitManager.buildPayloadForExitHermoine(
  //   '0xb580d143c27e98d13a5b54e3f432c4ce5e6e5c72c2ba5733d1b4175cec1da397', ERC20_TRANSFER_EVENT_SIG);
  // console.log("Burn proof:", proof);

  // const proof = await matic.posRootChainManager.exitManager.buildPayloadForExitHermoine(
  //   BURN_HASH, ERC20_TRANSFER_EVENT_SIG);
  // console.log("Burn proof:", proof);



const Matic = require("@maticnetwork/maticjs").default;
const matic = new Matic({
  maticProvider: "https://matic-mumbai.chainstacklabs.com",
  parentProvider: "https://goerli.infura.io/v3/de5e2a8780c04964950e73b696d1bfb1",
  // rootChain: "0x2890bA17EfE978480615e330ecB65333b880928e",
  // withdrawManager: "0x2923C8dD6Cdf6b2507ef91de74F1d5E0F11Eac53",
  // depositManager: "0x7850ec290A2e2F40B82Ed962eaf30591bb5f5C96",
  // registry: "0xeE11713Fe713b2BfF2942452517483654078154D",
});
const exit_manager = matic.withdrawManager.exitManager;
const BURN_HASH = '0x3f8a6e175862601408288ecc5032b8f8b94b187ebc4eb82e744456c9bd3379c6';
const SIG = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const proof = await exit_manager.buildPayloadForExitHermoine(BURN_HASH, SIG);
console.log("Burn proof:", proof);
}

async function connectEthereumWallet(): Promise<Wallet> {
  const signingKey = askForSigningKey("to sign all the transactions");
  const provider = askForEthereumProvider();
  return connectWallet(signingKey, provider);
}

async function connectPolygonWallet(): Promise<Wallet> {
  const signingKey = askForSigningKey("to sign all the transactions");
  const provider = askForPolygonProvider();
  return connectWallet(signingKey, provider);
}

async function connectPolygonL1Wallet(polygonWallet: Wallet): Promise<Wallet> {
  const network = await polygonWallet.provider.getNetwork();
  const provider = getPolygonL1Provider(network.chainId);
  return connectWallet(polygonWallet.privateKey, provider);
}

async function connectWallet(
  signingKey: string | SigningKey,
  provider: providers.Provider
): Promise<Wallet> {
  const wallet = new Wallet(signingKey, provider);
  const network = await wallet.provider.getNetwork();
  const networkName = `${network.name} (chain ID ${network.chainId})`;
  console.log("Connected to", networkName, "using account", wallet.address);

  const defaultGasPrice = await provider.getGasPrice();
  const gasPrice = askForGasPrice(`to use in all ${networkName} transactions`, defaultGasPrice);
  provider.getGasPrice = function (): Promise<BigNumber> {
    return Promise.resolve(gasPrice);
  };
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const superSendTransaction = provider.sendTransaction;
  provider.sendTransaction = async (txBytes): Promise<providers.TransactionResponse> => {
    const tx = utils.parseTransaction(await txBytes);
    console.log("Sending transaction to", networkName, tx.hash);
    return superSendTransaction.call(provider, txBytes);
  };

  return wallet;
}

function askForSigningKey(keyUsage: string): SigningKey {
  for (;;) {
    let key = askFor("the private key " + keyUsage, undefined, true);
    if (!key.startsWith("0x")) {
      key = "0x" + key;
    }
    try {
      return new SigningKey(key);
    } catch (e) {
      printInvalidInput("private key");
    }
  }
}

function askForEthereumProvider(): providers.Provider {
  const network = askForNetwork("to connect to", ["mainnet", "ropsten", "rinkeby", "goerli"]);
  return new providers.InfuraProvider(network, INFURA_ID);
}

function askForPolygonProvider(): providers.Provider {
  const network = askForNetwork("to connect to", ["mainnet", "mumbai"]);
  const clientUrl = `https://matic-${network}.chainstacklabs.com`;
  return new providers.JsonRpcProvider(clientUrl);
}

function getPolygonL1Provider(polygonNetworkId: number): providers.Provider {
  let network;
  switch (polygonNetworkId) {
    case 137:
      network = "mainnet";
      break;
    case 80001:
      network = "goerli";
      break;
    default:
      throw `Unknown Polygon network ID '${polygonNetworkId}'`;
  }
  return new providers.InfuraProvider(network, INFURA_ID);
}

function askForNetwork(networkUsage: string, networks: string[]): string {
  // const networks = ["mainnet", "ropsten", "rinkeby"];
  const query = "Enter the network " + networkUsage;
  const network = keyInSelect(networks, query, { cancel: false });
  return networks[network];
}

function askForGasPrice(gasUsage: string, defaultPrice: BigNumber): BigNumber {
  const giga = 10 ** 9;
  const question = "gas price " + gasUsage + " in GWei";
  const defaultPriceGwei = (defaultPrice.toNumber() / giga).toString();
  for (;;) {
    const priceStr = askFor(question, defaultPriceGwei);
    const price = parseFloat(priceStr);
    if (Number.isFinite(price) && price >= 0) {
      const priceWei = (price * giga).toFixed();
      return BigNumber.from(priceWei);
    }
    printInvalidInput("amount");
  }
}

function askForAddress(addressUsage: string): string {
  for (;;) {
    const address = askFor("the address " + addressUsage);
    if (utils.isAddress(address)) {
      return address;
    }
    printInvalidInput("address");
  }
}

function askForAmount(amountUsage: string, decimals: number, symbol: string): BigNumber {
  const amount = askForBigNumber("amount " + amountUsage + " in " + symbol);
  return BigNumber.from(10).pow(decimals).mul(amount);
}

function askForBigNumber(numberUsage: string): BigNumber {
  for (;;) {
    const bigNumber = askFor(numberUsage);
    try {
      return BigNumber.from(bigNumber);
    } catch (e) {
      printInvalidInput("number");
    }
  }
}

function askForNumber(numberUsage: string): number {
  for (;;) {
    const numStr = askFor(numberUsage);
    const num = parseInt(numStr);
    if (Number.isInteger(num)) {
      return num;
    }
    printInvalidInput("number");
  }
}

function askForTimestamp(dateUsage: string): number {
  for (;;) {
    const dateStr = askFor(
      "the date " +
        dateUsage +
        " in the ISO-8601 format, e.g. 2020-01-21, the timezone is UTC if unspecified"
    );
    try {
      const date = new Date(dateStr);
      return date.valueOf() / 1000;
    } catch (e) {
      printInvalidInput("date");
    }
  }
}

function askForDaysInSeconds(daysUsage: string): number {
  const days = askForNumber(daysUsage + " in whole days");
  return days * 24 * 60 * 60;
}

function askYesNo(query: string): boolean {
  return keyInYNStrict(query);
}

function askFor(query: string, defaultInput?: string, hideInput = false): string {
  const questionDefault = defaultInput === undefined ? "" : " (default: " + defaultInput + ")";
  const options = {
    hideEchoBack: hideInput,
    limit: /./,
    limitMessage: "",
    defaultInput,
  };
  return question("Enter " + query + questionDefault + ":\n", options);
}

function printInvalidInput(inputType: string): void {
  console.log("This is not a valid", inputType);
}

async function deploy<T extends Contract>(name: string, fn: () => Promise<T>): Promise<T> {
  for (;;) {
    try {
      console.log("Deploying", name, "contract");
      const contract = await fn();
      printDeployed(name, contract.address);
      return contract;
    } catch (e) {
      console.log(e);
      if (askYesNo("Retry?") == false) {
        throw "Deployment failed";
      }
    }
  }
}

function printDeployed(name: string, address: string): void {
  console.log("Deployed", name, "contract", "under address", address);
}
