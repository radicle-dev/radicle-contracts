import {
  deployEns,
  setSubnodeOwner,
  deployRadicleToken,
  deployTimelock,
  deployGovernance,
  deployTreasury,
  deployRegistrar,
  deployVestingToken,
} from "./deploy";
import assert from "assert";
import { nameHash } from "./ens";
import WalletConnectProvider from "@walletconnect/web3-provider";
import { BigNumber, Contract, constants, providers, utils } from "ethers";
import readline from "readline";
import { ENS__factory } from "../contract-bindings/ethers";

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
  console.log(question);
  const rl = readline.createInterface({ input: process.stdin });
  const next = await rl[Symbol.asyncIterator]().next();
  rl.close();
  return next.value as string;
}

async function deploy<T extends Contract>(
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  console.log("Deploying", name, "contract");
  const contract = await fn();
  console.log("Deployed", name, "contract", "under address", contract.address);
  return contract;
}

export async function testEns(): Promise<void> {
  console.log("The wallet address will be the owner of the radicle.eth domain");
  const provider = await walletConnectProvider();
  const signer = provider.getSigner();
  const signerAddr = await signer.getAddress();
  const ens = await deploy("ENS", () => deployEns(signer));
  console.log("Registering domain eth");
  await setSubnodeOwner(ens, "", "eth", signerAddr);
  console.log("Registered domain eth for", signerAddr);
  console.log("Registering domain radicle.eth");
  await setSubnodeOwner(ens, "eth", "radicle", signerAddr);
  console.log("Registered domain 'radicle.eth' for", signerAddr);
  await provider.close();
}

export async function phase0(): Promise<void> {
  const domain = "radicle.eth";
  console.log("The wallet address must own the", domain, "domain in the ENS");
  const provider = await walletConnectProvider();
  const signer = provider.getSigner();
  const govGuardian = await askForAddress("of the governor guardian");
  const tokensHolder = await askForAddress("to hold all the Radicle Tokens");
  const ensAddr = await askForAddress("of the ENS");

  const token = await deploy("Radicle Token", () =>
    deployRadicleToken(signer, tokensHolder)
  );

  const govAddr = utils.getContractAddress({
    from: await signer.getAddress(),
    nonce: 2 + (await signer.getTransactionCount()),
  });
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

  const registrar = await deploy("registrar", () =>
    deployRegistrar(
      signer,
      constants.AddressZero, // oracle not used yet
      constants.AddressZero, // exchange not used yet
      token.address,
      ensAddr,
      domain,
      timelockAddr
    )
  );

  console.log("Passing ownership of the", domain, "domain to the registrar");
  const ens = ENS__factory.connect(ensAddr, signer);
  await ens.setOwner(nameHash(domain), registrar.address);
  console.log("Registrar owns the ", domain, "domain");

  await provider.close();
}

export async function vestingTokens(): Promise<void> {
  console.log("The wallet owner will be the one providing tokens for vesting");
  const provider = await walletConnectProvider();
  const signer = provider.getSigner();
  const token = await askForAddress("of the token");
  const owner = await askForAddress("of the owner of all created vestings");
  const dayLength = 60 * 60 * 24;
  const yearLength = dayLength * 365;
  const year2020Length = yearLength + dayLength; // 2020 was a leap year
  const vestingPeriod = year2020Length + 3 * yearLength;
  const cliffPeriod = year2020Length;
  do {
    const beneficiary = await askForAddress("of beneficiary");
    const amount = await askForBigNumber("amount to vest");
    const vestingStartTime = await askForBigNumber(
      "vesting start time in seconds since epoch"
    );
    await deploy("vesting tokens", () =>
      deployVestingToken(
        signer,
        token,
        owner,
        beneficiary,
        amount,
        vestingStartTime,
        vestingPeriod,
        cliffPeriod
      )
    );
    console.log(beneficiary, "has", amount, "vested");
  } while (await askYesNo("Create another vesting?"));
  await provider.close();
}
