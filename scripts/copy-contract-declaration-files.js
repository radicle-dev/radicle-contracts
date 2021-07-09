const path = require("path");
const fs = require("fs").promises;
const fastGlob = require("fast-glob");

// Copies all `.d.ts` files from `contract-bindings` to the build
// directory so that dependents pick them up properly.
//
// See https://github.com/ethereum-ts/TypeChain/issues/430

// eslint-disable-next-line @typescript-eslint/no-floating-promises
(async function main() {
  const projectRoot = path.resolve(__dirname, "..");
  const declarationFiles = await fastGlob(
    ["contract-bindings/ethers/**/*.d.ts"],
    { cwd: projectRoot }
  );
  for (const file of declarationFiles) {
    await fs.copyFile(
      path.resolve(projectRoot, file),
      path.resolve(projectRoot, "build", file)
    );
  }
})();
