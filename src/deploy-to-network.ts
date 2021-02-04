import { deployTestEns, deployVestingToken, deployPhase0 } from "./deploy";
import { BigNumber, Contract, Wallet, Signer, providers, utils } from "ethers";
import SigningKey = utils.SigningKey;
import { keyInSelect, keyInYNStrict, question } from "readline-sync";
import { ERC20__factory } from "../contract-bindings/ethers";

const INFURA_ID = "de5e2a8780c04964950e73b696d1bfb1";

export async function testEns(): Promise<void> {
  console.log("The deployer will become an owner of the '', 'eth' and '<domain>.eth' domains,");
  console.log("the owner of the root ENS and the owner and controller of the 'eth' registrar");
  const signer = await connectPrivateKeySigner();
  const label = askFor("an 'eth' subdomain to register");
  await deploy("ENS", () => deployTestEns(signer, label));
}

export async function phase0(): Promise<void> {
  const signer = await connectPrivateKeySigner();
  const governorGuardian = askForAddress("of the governor guardian");
  const tokensHolder = askForAddress("to hold all the Radicle Tokens");
  const ensAddr = askForAddress("of the ENS");
  const ethLabel = askFor("an 'eth' subdomain on which the registrar should operate");
  const timelockDelay = 60 * 60 * 24 * 2;

  const phase0 = await deploy("phase0", () =>
    deployPhase0(signer, tokensHolder, timelockDelay, governorGuardian, ensAddr, ethLabel)
  );

  printDeployed("Radicle Token", await phase0.token());
  printDeployed("Timelock", await phase0.timelock());
  printDeployed("Governor", await phase0.governor());
  printDeployed("Registrar", await phase0.registrar());
  console.log(`Remember to give the '${ethLabel}.eth' domain to the registrar`);
}

export async function vestingTokens(): Promise<void> {
  console.log("The deployer will be the one providing tokens for vesting");
  const signer = await connectPrivateKeySigner();
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

async function connectPrivateKeySigner(): Promise<Signer> {
  const signingKey = askForSigningKey("to sign all the transactions");
  const network = askForNetwork("to connect to");
  const provider = new providers.InfuraProvider(network, INFURA_ID);
  const wallet = new Wallet(signingKey, provider);
  const networkName = (await wallet.provider.getNetwork()).name;
  console.log("Connected to", networkName, "using account", wallet.address);

  const defaultGasPrice = await provider.getGasPrice();
  const gasPrice = askForGasPrice("to use in all transactions", defaultGasPrice);
  provider.getGasPrice = function (): Promise<BigNumber> {
    return Promise.resolve(gasPrice);
  };
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const superSendTransaction = provider.sendTransaction;
  provider.sendTransaction = async (txBytes): Promise<providers.TransactionResponse> => {
    const tx = utils.parseTransaction(await txBytes);
    console.log("Sending transaction", tx.hash);
    return superSendTransaction.call(provider, txBytes);
  };

  return wallet;
}

function askForSigningKey(keyUsage: string): SigningKey {
  for (;;) {
    const key = askFor("the private key " + keyUsage, undefined, true);
    try {
      return new SigningKey(key);
    } catch (e) {
      printInvalidInput("private key");
    }
  }
}

function askForNetwork(networkUsage: string): string {
  const networks = ["mainnet", "ropsten"];
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
  for (;;) {
    const daysStr = askFor(daysUsage + " in whole days");
    const days = parseInt(daysStr);
    if (Number.isInteger(days)) {
      return days * 24 * 60 * 60;
    }
    printInvalidInput("number");
  }
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
