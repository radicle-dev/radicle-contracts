module.exports = {
  root: true,
  env: {
    node: true,
  },
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  ignorePatterns: ["build/**", "ethers-contracts/**", "cache/**"],
  rules: {
    "@typescript-eslint/explicit-function-return-type": "error",
  },
};
