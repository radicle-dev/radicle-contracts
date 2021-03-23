# Developer Manual

## Tasks

* `yarn run build` Build the contracts, client bindings and compile with
  typescript.
* `yarn run test` Rebuild the contract and client bindings and run all tests.
* `yarn run lint` Check with `prettier` and `solhint`. The tasks `lint:solhint`
  and `lint:prettier` are also available.

## Changelog and versioning

The project follows [Semantic Versioning] with regard to
its JavaScript and TypeScript bindings' APIs and the Ethereum ABI.
Any changes visible through any of these interfaces must be noted
in the changelog and reflected in the version number when a new release is made.
The changelog is manually updated in every commit that makes a change
and it follows the [Keep a Changelog] convention.

### Releasing a new version

Whenever a new version is released, a separate commit is created.
It contains all the version bumping work, which is:

- Wrap up the changes for the new version in `CHANGELOG.md` and open a new
`Unreleased` version.
- Bump version in `package.json`

The version bumping commit is the head of the branch merged into `master`.
The branch must be rebased and mergeable using the fast-forward option.
After the merge is finished, the `master`s head is tagged with
a git tag and a GitHub release.
Both of them are named using the version number with a `v` prefix,
e.g. `v0.0.1`, `v1.0.0`, `v1.2.3` or `v1.0.0-alpha`.

[Keep a Changelog]: https://keepachangelog.com/en/1.0.0/
[Semantic Versioning]: https://semver.org/spec/v2.0.0.html

## Updating CI's base Docker image

1. Update Docker's image tag to an unexistent tag

  In `.buildkite/pipeline.yaml` > `.test` > `env` > `DOCKER_IMAGE`,
  replace the image tag with a nonexistent tag (e.g. `does_not_exist`).

  Example:

  ```
  DOCKER_IMAGE: gcr.io/opensourcecoin/radicle-registry-eth/ci-base:d78a964e22d65fe45e1dcacdf5538de286e3624e
  ```
  to

  ```
  DOCKER_IMAGE: gcr.io/opensourcecoin/radicle-registry-eth/ci-base:does_not_exist
  ```

  Now, commit and push this change.

2. Wait for the build agent to build this commit

  **Make sure that this commit is preserved!**
  Do not amend, squash, rebase or delete it.
  It should be merged unmodified into master.
  This way it will be easy to look up the state
  of the project used by the build agent.

  **What happens on the build agent:** when no docker image
  is found for a given tag, the agent will run the full pipeline
  and save the docker image under a tag associated with the current
  commit ID.`

3. Update the docker image tag with step 1's commit ID

  Example:
  ```
  DOCKER_IMAGE: gcr.io/opensourcecoin/radicle-registry/ci-base:does_not_exist
  ```

  to

  ```
  DOCKER_IMAGE: gcr.io/opensourcecoin/radicle-registry/ci-base:e8c699d4827ed893d8dcdab6e72de40732ad5f3c
  ```

  **What happens on the build agent:** when any commit with this change is pushed,
  the build agent will find the image under the configured tag.
  It will reuse it instead of rebuilding, which saves a lot of time.


