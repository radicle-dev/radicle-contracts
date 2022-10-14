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

### Contracts deployed on Mainnet

  - `claims`: `0x4a7DFda4F2e9F062965cC87f775841fB58AEA83e` at height 12613127
  - `RAD token`: `0x31c8EAcBFFdD875c74b94b077895Bd78CF1E64A3` at height 11863739

### Contracts deployed on Goerli

  - `phase0`: `0x4a7DFda4F2e9F062965cC87f775841fB58AEA83e` at height 7751624
  - `RAD token`: `0x3EE94D192397aAFAe438C9803825eb1Aa4402e09` at height 7751624
  - `timelock`: `0x5815Ec3BaA7392c4b52A94F4Bda6B0aA09563428` at height 7751624
  - `governor`: `0xc1DB01b8a3cD5ef52f7a83798Ee21EdC7A7e9668` at height 7751624
  - `ENS registrar`: `0xD88303A92577bFDF5A82FddeF342F3A27A972405` at height 7757112
    - controller -> radicle-goerli.eth
  - `vesting`:
    - `0x9c882463B02221b0558112dec05F60D5B3D99b6a`
    - `0xAADcbc69f955523B0ff0A271229961E950538EbE`
    - `0x27BCA0692e13C122E6Fc105b3974B5df7246D464`
    - `0x13b2Fc1f601Fb72b86BFAB59090f22bB6E73005A`
