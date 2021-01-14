import * as deploy from "./deploy";
import WalletConnectProvider from "@walletconnect/web3-provider";
import { Contract, constants, providers, utils } from "ethers";
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

async function askFor(question: string): Promise<string> {
  console.log(question);
  const rl = readline.createInterface({ input: process.stdin });
  const next = await rl[Symbol.asyncIterator]().next();
  rl.close();
  return next.value as string;
}

function printDeployed(name: string, contract: Contract): void {
  console.log("Deployed", name, "contract to address", contract.address);
}

export async function testEns(): Promise<void> {
  const provider = await walletConnectProvider();
  const signer = provider.getSigner();
  const signerAddr = await signer.getAddress();
  const ens = await deploy.deployEns(signer);
  printDeployed("ENS", ens);
  await deploy.setSubnodeOwner(ens, "", "eth", signerAddr);
  console.log("Registered domain 'eth' for", signerAddr);
  await provider.close();
}

export async function phase0(): Promise<void> {
  const provider = await walletConnectProvider();
  const signer = provider.getSigner();
  const govGuardian = await askForAddress("of the governor guardian");
  const tokensHolder = await askForAddress("to hold all the Radicle Tokens");
  const ensAddr = await askForAddress("of the ENS");

  const token = await deploy.deployRadicleToken(signer, tokensHolder);
  printDeployed("Radicle Token", token);

  const govAddr = utils.getContractAddress({
    from: await signer.getAddress(),
    nonce: 1 + (await signer.getTransactionCount()),
  });
  const delay = 2 * 60 * 60 * 24;
  const timelock = await deploy.deployTimelock(signer, govAddr, delay);
  printDeployed("timelock", timelock);

  const gov = await deploy.deployGovernance(
    signer,
    timelock.address,
    token.address,
    govGuardian
  );
  printDeployed("governance", gov);

  const treasury = await deploy.deployTreasury(signer, govAddr);
  printDeployed("treasury", treasury);

  const ens = ENS__factory.connect(ensAddr, signer);
  const registrar = await deploy.deployRegistrar(
    signer,
    constants.AddressZero, // oracle not used yet
    constants.AddressZero, // exchange not used yet
    token.address,
    ens,
    "eth",
    "radicle",
    govAddr
  );
  printDeployed("registrar", registrar);

  await provider.close();
}
