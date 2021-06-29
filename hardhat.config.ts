import * as path from "path";
import { task } from "hardhat/config";
import {
  TASK_COMPILE,
  TASK_COMPILE_SOLIDITY_GET_COMPILER_INPUT,
} from "hardhat/builtin-tasks/task-names";
import { runTypeChain, glob } from "typechain";
import "@nomiclabs/hardhat-ethers";
import "@eth-optimism/hardhat-ovm";

// You have to export an object to set up your config
// This object can have the following optional entries:
// defaultNetwork, networks, solc, and paths.
// Go to https://hardhat.org/config/ to learn more
export default {
  // This is a sample solc configuration that specifies which version of solc to use
  solidity: {
    version: "0.7.6",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  defaultNetwork: "optimism",
  networks: {
    optimism: {
      url: "http://127.0.0.1:8545",
      chainId: 420,
      accounts: {
        mnemonic: "test test test test test test test test test test test junk",
      },
      // This sets the gas price to 0 for all transactions on L2.
      // We do this because account balances are not automatically initiated with ETH.
      gasPrice: 0,
      // This sets the network as using the ovm and ensure contract will be compiled against that.
      ovm: true,
    },
  },
};

// Additional contracts to generate TypeScript bindings for.
// Only contracts never used in .sol files should be listed here to avoid conflicts.
const contracts = [
  "node_modules/@ensdomains/ens/build/contracts/ENSRegistry.json",
  "ethregistrar/build/contracts/BaseRegistrar.json",
  "ethregistrar/build/contracts/BaseRegistrarImplementation.json",
  "node_modules/@uniswap/v2-core/build/UniswapV2Factory.json",
  "node_modules/@uniswap/v2-periphery/build/UniswapV2Router02.json",
  "node_modules/@uniswap/v2-periphery/build/WETH9.json",
];

task(TASK_COMPILE).setAction(async (_, runtime, runSuper) => {
  await runSuper();
  const artifacts = await runtime.artifacts.getArtifactPaths();
  artifacts.push(...contracts.map((contract) => path.resolve(contract)));
  const artifactsGlob = "{" + artifacts.join(",") + "}";
  await typeChain(artifactsGlob, ".");
  console.log(`Successfully generated Typechain artifacts!`);
});

task(TASK_COMPILE_SOLIDITY_GET_COMPILER_INPUT).setAction(async (_, __, runSuper) => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const input = await runSuper();
  // eslint-disable-next-line
  input.settings.outputSelection["*"]["*"].push("storageLayout");
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return input;
});

async function typeChain(filesGlob: string, modulePath: string): Promise<void> {
  const outDir = "./contract-bindings";
  const cwd = process.cwd();
  const allFiles = glob(cwd, [filesGlob]);
  await runTypeChain({
    cwd,
    filesToProcess: allFiles,
    allFiles,
    outDir: path.join(outDir, "ethers", modulePath),
    target: "ethers-v5",
  });
  await runTypeChain({
    cwd,
    filesToProcess: allFiles,
    allFiles,
    outDir: path.join(outDir, "web3", modulePath),
    target: "web3-v1",
  });
}
