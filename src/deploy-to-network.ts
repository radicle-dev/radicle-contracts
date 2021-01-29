import {
  deployTestEns,
  deployRadicleToken,
  deployTimelock,
  deployGovernance,
  deployTreasury,
  deployRegistrar,
  deployVestingToken,
  nextDeployedContractAddr,
} from "./deploy";
import assert from "assert";
import WalletConnectProvider from "@walletconnect/web3-provider";
import { BigNumber, Contract, constants, providers, utils } from "ethers";
import { keyInYNStrict, question } from "readline-sync";
import { ERC20__factory } from "../contract-bindings/ethers";

const INFURA_ID = "de5e2a8780c04964950e73b696d1bfb1";

export async function testEns(): Promise<void> {
  console.log(
    "The wallet will become an owner of the '', 'eth' and '<domain>.eth' domains,"
  );
  console.log(
    "the owner of the root ENS and the owner and controller of the 'eth' registrar"
  );
  const provider = await walletConnectProvider();
  const signer = provider.getSigner();
  const label = askFor("Enter an 'eth' subdomain to register");
  await deploy("ENS", () => deployTestEns(signer, label));
  await provider.close();
}

export async function phase0(): Promise<void> {
  const provider = await walletConnectProvider();
  const signer = provider.getSigner();
  const govGuardian = askForAddress("of the governor guardian");
  const tokensHolder = askForAddress("to hold all the Radicle Tokens");
  const ensAddr = askForAddress("of the ENS");
  const label = askFor(
    "Enter an 'eth' subdomain on which the registrar should operate"
  );

  const token = await deploy("Radicle Token", () =>
    deployRadicleToken(signer, tokensHolder)
  );

  const govAddr = await nextDeployedContractAddr(signer, 1);
  const delay = 60 * 60 * 24 * 2;
  const timelock = await deploy("timelock", () =>
    deployTimelock(signer, govAddr, delay)
  );
  const timelockAddr = timelock.address;

  const governance = await deploy("governance", () =>
    deployGovernance(signer, timelockAddr, token.address, govGuardian)
  );
  assert.strictEqual(
    governance.address,
    govAddr,
    "Governance deployed under an unexpected address"
  );

  await deploy("treasury", () => deployTreasury(signer, timelockAddr));

  await deploy("registrar", () =>
    deployRegistrar(
      signer,
      constants.AddressZero, // oracle not used yet
      constants.AddressZero, // exchange not used yet
      token.address,
      ensAddr,
      label,
      timelockAddr
    )
  );
  console.log(`Registrar owns the '${label}.eth' domain`);

  await provider.close();
}

export async function vestingTokens(): Promise<void> {
  console.log("The wallet owner will be the one providing tokens for vesting");
  const provider = await walletConnectProvider();
  const signer = provider.getSigner();
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
  await provider.close();
}

interface Provider extends providers.Web3Provider {
  close(): Promise<void>;
}

async function walletConnectProvider(): Promise<Provider> {
  const walletConnect = new WalletConnectProvider({ infuraId: INFURA_ID });
  const web3Provider = new providers.Web3Provider(walletConnect);
  const closeFn = (): Promise<void> => walletConnect.close();
  const provider: Provider = Object.assign(web3Provider, { close: closeFn });

  console.log("Connecting to the wallet with WalletConnect");
  await walletConnect.enable();
  const networkName = (await provider.getNetwork()).name;
  const address = await provider.getSigner().getAddress();
  console.log("Connected to", networkName, "using account", address);

  return provider;
}

function askForAddress(addressUsage: string): string {
  for (;;) {
    const address = askFor("Enter the address " + addressUsage + ":");
    if (utils.isAddress(address)) {
      return address;
    }
    console.log("This is not a valid address");
  }
}

function askForAmount(
  amountUsage: string,
  decimals: number,
  symbol: string
): BigNumber {
  const amount = askForBigNumber("amount " + amountUsage + " in " + symbol);
  return BigNumber.from(10).pow(decimals).mul(amount);
}

function askForBigNumber(numberUsage: string): BigNumber {
  for (;;) {
    const bigNumber = askFor("Enter " + numberUsage + ":");
    try {
      return BigNumber.from(bigNumber);
    } catch (e) {
      console.log("This is not a valid number");
    }
  }
}

function askForTimestamp(dateUsage: string): number {
  for (;;) {
    const dateStr = askFor(
      "Enter the date " +
        dateUsage +
        " in the ISO-8601 format, e.g. 2020-01-21, the timezone is UTC if unspecified:"
    );
    try {
      const date = new Date(dateStr);
      return date.valueOf() / 1000;
    } catch (e) {
      console.log("This is not a valid date");
    }
  }
}

function askForDaysInSeconds(daysUsage: string): number {
  for (;;) {
    const daysStr = askFor("Enter " + daysUsage + " in whole days:");
    const days = parseInt(daysStr);
    if (Number.isInteger(days)) {
      return days * 24 * 60 * 60;
    }
  }
}

function askYesNo(query: string): boolean {
  return keyInYNStrict(query);
}

function askFor(query: string, hideInput = false): string {
  const options = { hideEchoBack: hideInput };
  for (;;) {
    const response = question(query + "\n", options);
    if (response != "") {
      return response;
    }
  }
}

async function deploy<T extends Contract>(
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  for (;;) {
    try {
      console.log("Deploying", name, "contract");
      const contract = await fn();
      console.log(
        "Deployed",
        name,
        "contract",
        "under address",
        contract.address
      );
      return contract;
    } catch (e) {
      console.log(e);
      console.log("Retrying");
    }
  }
}
