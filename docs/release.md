# Releasing Print Tally

Print Tally ships two things, each with its own version, tag and changelog:

- **The backend**: the `printtally` npm package in `apps/server`, which includes the web UI. Tags are `backend-vX.Y.Z`, and the changelog is `apps/server/CHANGELOG.md`.
- **The app**: the desktop app in `apps/desktop`. Tags are `app-vX.Y.Z`, and the changelog is `apps/desktop/CHANGELOG.md`.

Releases are trunk-based. Nobody tags by hand.

1. Work on a feature branch and open a pull request. CI (`.github/workflows/ci.yml`) typechecks, tests and packs it.
2. Merge the pull request into main. Use a [Conventional Commits](https://www.conventionalcommits.org) title, such as `fix(server): …` or `feat(desktop): …`, because it decides what gets released.
3. On every push to main, the release workflow (`.github/workflows/release.yml`) runs [release-please](https://github.com/googleapis/release-please). It opens or updates one release PR, `chore: release main`, with the next version of each component and its changelog.
4. Merge the release PR when you want to ship. That merge is the release. release-please tags each component in it and creates its GitHub release, then the jobs below publish them.

## What gets released

Only `feat`, `fix`, `perf` and `revert` commits and breaking changes (`!`) release anything. `docs`, `chore`, `test`, `ci`, `refactor`, `style` and `build` commits don't, unless they're breaking. For a dependency update that should ship, use `fix(deps): …`.

| A releasable commit that touches | Releases |
| --- | --- |
| `apps/server`, `apps/web` or `packages/*` | the backend, and the app |
| `apps/desktop` only | the app |
| `docs`, `scripts`, `tests` or `.github` only | nothing |

The app always follows a backend release, because it embeds the backend. It gets its own next version: a backend release alone bumps the app's patch version. The two versions are never kept equal. A commit that touches only top-level files, such as `package.json`, `bun.lock` or `README.md`, counts as a backend change.

Before 1.0.0, a breaking change bumps the minor version. The first release of each is 0.1.0.

## What each job publishes

| Job | Runs when | Publishes |
| --- | --- | --- |
| `release-please` | every push to main | the release PR, or, when it's merged, the tags and GitHub releases |
| `npm-prepare` | the backend was released | nothing; it tests, skips a version already on npm, and packs the package with `bun pm pack` |
| `npm-publish` | `npm-prepare` packed a package | `printtally` on npm, through trusted publishing (OIDC) from the `release` environment. It's the only job with `id-token: write`, its actions are pinned to commits, and it runs no install scripts |
| `backend-assets` | the backend was released and tested | `printtally-server-X.Y.Z-darwin-arm64.tar.gz` and its `.sha256`, on the backend's GitHub release: the compiled server and its UI, checked to report version X.Y.Z |
| `app` | the app was released | `PrintTally-X.Y.Z.dmg` and `PrintTally-X.Y.Z.zip`, signed, notarized and stapled, on the app's GitHub release |

The app doesn't compile its own server. It downloads the server archive from the backend release made in the same run, or, for an app-only release, from the latest `backend-v*` release. It checks the archive's checksum, then `apps/desktop/scripts/bundle.sh` packages it (`PRINTTALLY_SERVER_ARCHIVE`). So the **Backend version** that Settings shows in a shipped app is always a published backend version.

Every job uses Bun 1.3.9.

## One-time setup

1. **The `release` environment.** In the repository settings, under Environments, limit `release` to the `main` branch. Add these secrets to it:
   - `DEVID_P12_BASE64` and `DEVID_P12_PASSWORD`: the Developer ID Application certificate for team D6AAJCLH87, exported as a `.p12` and base64-encoded.
   - `ASC_KEY_ID`, `ASC_ISSUER_ID` and `ASC_KEY_P8`: an App Store Connect API key for notarization. `ASC_KEY_P8` is the contents of the `.p8` file.
2. **Let Actions open pull requests.** Under Settings → Actions → General → Workflow permissions, turn on "Allow GitHub Actions to create and approve pull requests". release-please uses the workflow's own `GITHUB_TOKEN`. GitHub doesn't run other workflows for pull requests opened with that token, so CI doesn't run on the release PR. That's fine: the release PR only changes versions and changelogs, the code already passed CI on `main`, and the release jobs run the tests again before publishing. Merge it using your bypass, or close and reopen it to run CI.
3. **Protect main.** Add a branch ruleset for `main` that:
   - requires a pull request before merging.
   - requires the status checks **Typecheck and test** and **Package**.
   - blocks direct pushes and force pushes.
   - lets only you bypass it, by pull request only. The release PR ships when it's merged, so only the owner should merge it.
4. **npm trusted publishing.** On npmjs.com, open the `printtally` package settings and add a trusted publisher: GitHub Actions, repository `discorev/printtally`, workflow `release.yml`, environment `release`, with **Allow npm publish** ticked. Only jobs in the `release` environment, which only `main` can deploy to, can then publish. The package's `repository` field (`apps/server/package.json`) must name the same repository, as it already does.

## Publishing a backend tag again

If publishing failed, fix the cause, then publish the released tag again from Actions → Release → Run workflow, with `backend_tag` set to the tag (for example `backend-v0.1.0`). A manual run only publishes that tag; it doesn't run release-please or build the app, and it skips a version that's already on npm.

## How release-please is configured

The config is `.github/release-please/config.json`, and the last released versions are in `.github/release-please/manifest.json`.

release-please 17 only counts a commit towards a component if it touches the component's folder. The backend is built from three folders, so it's the root component (`.`), which counts every commit. Its `exclude-paths` leave out the app and the folders that don't ship. Because it's a `node` component, the release PR also sets the backend version in the root `package.json`. `extra-files` sets it in `apps/server/package.json`, which the npm package and the compiled server read it from.

The app follows the backend through release-please's `node-workspace` plugin, which bumps a package when one it depends on is released. The plugin reads the backend's name from the root `package.json`, `printtally-workspace`. Bun won't let a workspace depend on the root, so `apps/desktop/package.json` names it as an optional peer dependency:

```json
"peerDependencies": { "printtally-workspace": "workspace:*" },
"peerDependenciesMeta": { "printtally-workspace": { "optional": true } }
```

Bun never installs an optional peer, so this only tells release-please that the app depends on the backend. The plugin's `updatePeerDependencies` option makes it read peer dependencies.

`tests/release.test.ts` runs release-please itself offline, with the version that `release-please-action@v5` bundles (the pinned `release-please` dev dependency). It checks the rules above, and that both components land in one release PR. Run `bun test tests/release.test.ts` after changing the config.

## Local release builds

`PRINTTALLY_RELEASE=1 bun run dist:desktop` makes a signed release build on your Mac without notarizing it. To package a published backend instead of compiling the server, download its `printtally-server-X.Y.Z-darwin-arm64.tar.gz` and set `PRINTTALLY_SERVER_ARCHIVE` to its path. See [build.md](build.md) for the other build variables.

## Removing this setup

To go back to releasing by hand, delete:

- `.github/workflows/release.yml`
- `.github/release-please/`
- `tests/release.test.ts`
- this file, and the links to it in `README.md`, `ARCHITECTURE.md` and `docs/build.md`

Then remove the `release-please` dev dependency from the root `package.json`, and the `peerDependencies` and `peerDependenciesMeta` from `apps/desktop/package.json`. The root `package.json` can drop its `version` too. `ci.yml` and the `PRINTTALLY_SERVER_ARCHIVE` option in `apps/desktop/scripts/bundle.sh` work on their own, so you can keep them.
