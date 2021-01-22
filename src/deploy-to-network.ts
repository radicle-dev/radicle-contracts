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
import readline from "readline";
import { ERC20__factory } from "../contract-bindings/ethers";

const INFURA_ID = "de5e2a8780c04964950e73b696d1bfb1";

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

async function askForAddress(addressUsage: string): Promise<string> {
  for (;;) {
    const address = await askFor("Enter the address " + addressUsage + ":");
    if (utils.isAddress(address)) {
      return address;
    }
    console.log("This is not a valid address");
  }
}

async function askForAmount(
  amountUsage: string,
  decimals: number,
  symbol: string
): Promise<BigNumber> {
  const amount = await askForBigNumber(
    "amount " + amountUsage + " in " + symbol
  );
  return BigNumber.from(10).pow(decimals).mul(amount);
}

async function askForBigNumber(numberUsage: string): Promise<BigNumber> {
  for (;;) {
    const bigNumber = await askFor("Enter " + numberUsage + ":");
    try {
      return BigNumber.from(bigNumber);
    } catch (e) {
      console.log("This is not a valid number");
    }
  }
}

async function askForTimestamp(dateUsage: string): Promise<number> {
  for (;;) {
    const dateStr = await askFor(
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

async function askForDaysInSeconds(daysUsage: string): Promise<number> {
  for (;;) {
    const daysStr = await askFor("Enter " + daysUsage + " in whole days:");
    const days = parseInt(daysStr);
    if (Number.isInteger(days)) {
      return days * 24 * 60 * 60;
    }
  }
}

async function askYesNo(question: string): Promise<boolean> {
  for (;;) {
    switch (await askFor(question + " (yes/no):")) {
      case "y":
      case "yes":
        return true;
      case "n":
      case "no":
        return false;
    }
  }
}

async function askFor(question: string): Promise<string> {
  for (;;) {
    console.log(question);
    const rl = readline.createInterface({ input: process.stdin });
    for await (const line of rl) {
      if (line != "") {
        return line;
      }
    }
  }
}

async function deploy<T extends Contract>(
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  for(;;) {
    try {
      console.log("Deploying", name, "contract");
      const contract = await fn();
      console.log("Deployed", name, "contract", "under address", contract.address);
      return contract;
    } catch (e) {
      console.log(e);
      console.log("Retrying");
    }
  }
}

export async function testEns(): Promise<void> {
  console.log(
    "The wallet will become an owner of the '', 'eth' and '<domain>.eth' domains,"
  );
  console.log(
    "the owner of the root ENS and the owner and controller of the 'eth' registrar"
  );
  const provider = await walletConnectProvider();
  const signer = provider.getSigner();
  const label = await askFor("Enter an 'eth' subdomain to register");
  await deploy("ENS", () => deployTestEns(signer, label));
  await provider.close();
}

export async function phase0(): Promise<void> {
  const provider = await walletConnectProvider();
  const signer = provider.getSigner();
  const govGuardian = await askForAddress("of the governor guardian");
  const tokensHolder = await askForAddress("to hold all the Radicle Tokens");
  const ensAddr = await askForAddress("of the ENS");
  const label = await askFor(
    "Enter an 'eth' subdomain owned by the wallet to transfer to the registrar"
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
  const tokenAddr = await askForAddress("of the Radicle token contract");
  const token = ERC20__factory.connect(tokenAddr, signer);
  const decimals = await token.decimals();
  const symbol = await token.symbol();
  const owner = await askForAddress("of the vesting contracts admin");
  const vestingPeriod = await askForDaysInSeconds("the vesting period");
  const cliffPeriod = await askForDaysInSeconds("the cliff period");
  do {
    const beneficiary = await askForAddress("of beneficiary");
    const amount = await askForAmount("to vest", decimals, symbol);
    const vestingStartTime = await askForTimestamp("of the vesting start");
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
  } while (await askYesNo("Create another vesting?"));
  await provider.close();
}
