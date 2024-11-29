
# Contributing

## Code of Conduct

Please see `./CODE_OF_CONDUCT.md`.


## Release workflow

To create a new release:

- Submit a release PR targeting the `master` branch:
  - Bumps the version in `package.json`.
  - Run `npm install` to update the `package-lock.json`.
  - The commit message should be of the form "Release vx.y.z"
  - The title of the release PR should be of the form "Release vx.y.z"

- Once the PR is merged, create a new release:
  - Go the GitHub repo, and navigate to ["Releases"](https://github.com/fortanix/openapi-to-effect/releases).
  - Click ["Draft a new release"](https://github.com/fortanix/openapi-to-effect/releases/new).
  - Under "Choose a new tag", create a new tag of the form `vx.y.z`.
  - The name of the release should be of the form `vx.y.z`.
  - Write the release notes.
  - If the version is a pre-release, mark it as such.
  - Hit "Publish the release".

- Once the release has been created, a GitHub Actions workflow will automatically run to publish this release to npm.
