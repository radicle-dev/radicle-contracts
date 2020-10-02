import * as path from "path";
import {usePlugin, task} from "@nomiclabs/buidler/config";
import {TASK_COMPILE} from "@nomiclabs/buidler/builtin-tasks/task-names";
import {tsGenerator} from "ts-generator";
import {TypeChain} from "typechain/dist/TypeChain";

usePlugin("@nomiclabs/buidler-ethers");

// You have to export an object to set up your config
// This object can have the following optional entries:
// defaultNetwork, networks, solc, and paths.
// Go to https://buidler.dev/config/ to learn more
export default {
  // This is a sample solc configuration that specifies which version of solc to use
  solc: {
    version: "0.6.12",
  },
};

task(TASK_COMPILE).setAction(async (_, {config}, runSuper) => {
  await runSuper();

  await typeChain(`${config.paths.artifacts}/*.json`, ".");
  await typeChain(
    "./node_modules/@uniswap/v2-*/build/UniswapV2*.json",
    "uniswap-v2"
  );

  console.log(`Successfully generated Typechain artifacts!`);
});

import {TASK_COMPILE_GET_COMPILER_INPUT} from "@nomiclabs/buidler/builtin-tasks/task-names";

task(TASK_COMPILE_GET_COMPILER_INPUT).setAction(async (_, __, runSuper) => {
  const input = await runSuper();
  // input.settings.metadata.useLiteralContent = true;
  input.settings.outputSelection["*"]["*"].push("storageLayout");
  return input;
});

async function typeChain(files: string, modulePath: string): Promise<void> {
  const outDir = "./contract-bindings";
  const cwd = process.cwd();
  await tsGenerator({cwd}, [
    new TypeChain({
      cwd,
      rawConfig: {
        files,
        outDir: path.join(outDir, "ethers", modulePath),
        target: "ethers-v5",
      },
    }),
    new TypeChain({
      cwd,
      rawConfig: {
        files,
        outDir: path.join(outDir, "web3", modulePath),
        target: "web3-v1",
      },
    }),
  ]);
}
