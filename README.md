# Radicle Ethereum Contracts

See [`DEVELOPING.md`](./DEVELOPING.md) for the developer manual.

See [`how_the_pool_works.md`](./docs/how_the_pool_works.md) for the introduction to
how the funding pool contract works.

## Installation

We provide a tarball of the package through [our
CI](https://buildkite.com/monadic/radicle-contracts). See the “Artifacts”
section of a build.

## Deployment

Run one of the following commands and follow the instructions provided:

    yarn deploy:claims
    yarn deploy:erc20FundingPool
    yarn deploy:phase0
    yarn deploy:playground
    yarn deploy:testEns
    yarn deploy:vestingTokens

### Claims aka attestations contracts

  - `Rinkeby`: `0x6c7b50EA0AFB02d73AE3846B3B9EBC31808300a6` at height 8573482
  - `Ropsten`: `0xF8F22AA794DDA79aC0C634a381De0226f369bCCe` at height 9889396
  - `Mainnet`: `0x4a7DFda4F2e9F062965cC87f775841fB58AEA83e` at height 12613127

### Funding pool aka token streams

  - `Rinkeby`: `0x8c6E1E293346cc4cD31A1972D94DaDcecEd98997` at height 8572956
  - `Ropsten`: `0x22B39d2F5768CE402077223b3f871d9b4393A5f2` at height 10221422
  - `Mainnet`: not yet deployed

### Radicle (RAD) token contracts

  - `Rinkeby`: `0x7b6CbebC5646D996d258dcD4ca1d334B282e9948` at height 8665460
  - `Ropsten`: `0x59b5eee36f5fa52400A136Fd4630Ee2bF126a4C0` at height 9724721
  - `Mainnet`: `0x31c8EAcBFFdD875c74b94b077895Bd78CF1E64A3` at height 11863739
