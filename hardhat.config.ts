import * as path from "path";
import { task } from "hardhat/config";
import {
  TASK_COMPILE,
  TASK_COMPILE_SOLIDITY_GET_COMPILER_INPUT,
} from "hardhat/builtin-tasks/task-names";
import { runTypeChain, glob } from "typechain";
import "@nomiclabs/hardhat-ethers";

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
};

// Additional contracts to generate TypeScript bindings for.
// Only contracts never used in .sol files should be listed here to avoid conflicts.
const contracts = [
  "node_modules/@ensdomains/ens/build/contracts/ENSRegistry.json",
  "ethregistrar/build/contracts/BaseRegistrar.json",
  "ethregistrar/build/contracts/BaseRegistrarImplementation.json",
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
