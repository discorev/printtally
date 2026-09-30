# Building Print Tally

Most people should run `bunx printtally` or install the signed desktop app. This page is for working on Print Tally itself.

## Requirements

- [Bun](https://bun.sh) 1.3.9 or newer.
- For the desktop app: an Apple Silicon Mac with Xcode or the Command Line Tools (`codesign`, and `swift` to render the disk image background).
- A Developer ID Application certificate in your keychain to sign the desktop app. See [Signing](#signing) for building without one.

## Build and test

```sh
bun install
bun run typecheck && bun test
bun run test:packed    # packs the printtally npm package and checks what's in it
```

`bun run dev` runs the server and the web UI with hot reload, and `bun run dev:desktop` runs the desktop app from source. Both use your real data folder and port 4318 unless you set `PRINTTALLY_PORT` and `PRINTTALLY_DATA_DIR`.

## Desktop app

Build a local desktop app with:

```sh
bun run dist:desktop
```

This runs two scripts. `scripts/bundle.sh` compiles the server, builds the app with electron-builder and signs it. It writes `apps/desktop/release/mac-arm64/Print Tally.app`. `scripts/make-dmg.sh` then makes `apps/desktop/release/PrintTally-<version>.dmg` from that app. The disk image shows the app on the left and an Applications link on the right, over `assets/dmg/background.svg`.

Local and release builds use the same name, Print Tally, and the same bundle identifier, `com.olliespage.PrintTally`. Run a local build from `apps/desktop/release`. Don't drag it into Applications over the release app.

`PRINTTALLY_RELEASE=1 bun run dist:desktop` makes a release build on your Mac, signed but not notarized. Only the release workflow notarizes (see [release.md](release.md)). Don't open a release build to try it out, because it uses your real ledger.

### Signing

Both builds sign with the first Developer ID Application identity in your keychain. If there isn't one, the build stops with an error.

| Variable | Effect |
| --- | --- |
| `PRINTTALLY_SIGN_IDENTITY` | Sign with a specific identity, by name or SHA-1 hash, instead of the first one found. |
| `PRINTTALLY_ALLOW_ADHOC_SIGNING=1` | Deliberately permit an ad-hoc signature for a local build when there's no identity. The app only opens on this Mac, and the disk image isn't signed. |
| `PRINTTALLY_VERSION` | Build this version instead of the one in `apps/desktop/package.json`. |
| `PRINTTALLY_RELEASE=1` | Make a release build: it uses the hardened runtime and a secure timestamp, and it fails without a Developer ID identity. `PRINTTALLY_SIGN_IDENTITY` still overrides the identity. |
| `PRINTTALLY_SERVER_ARCHIVE` | Package the server from this archive, a backend release's `printtally-server-<version>-darwin-arm64.tar.gz`, instead of compiling it from the checkout. The release workflow uses it (see [release.md](release.md#what-each-job-publishes)). |

Both builds give Electron's helpers and the embedded Bun server the JIT entitlements in `apps/desktop/build/`. Without `allow-jit`, the server runs about 9 times slower under the hardened runtime.

### Local builds never touch your real ledger

A local build writes `dist/build-info.json` into the app, and the app reads it at launch (`apps/desktop/src/build.ts`). Because of that, a local build:

- keeps its ledger in `~/Library/Application Support/printtally-dev`, not `printtally`.
- uses port 4319, so it never borrows or opens the release server on 4318.
- keeps its own settings, such as a saved remote host, in `printtally-dev/desktop`.
- keeps printer passwords in memory (`PRINTTALLY_MEMORY_SECRETS=1`), never in Keychain.
- honours `PRINTTALLY_PORT` and `PRINTTALLY_DATA_DIR`.

A release build always uses port 4318 and the real data folder, and it ignores both variables.

### Test data

For a throwaway ledger to open a local build against:

```sh
bun run seed:dev    # prints the folder it made; or: bun run seed:dev path/to/a-copy-of/jobs.json
PRINTTALLY_DATA_DIR=<that folder> "apps/desktop/release/mac-arm64/Print Tally.app/Contents/MacOS/Print Tally"
```

The seed imports a snapshot (the synthetic `tests/fixtures/reference.json` by default), then adds papers, stock, purchases, ink cartridges and write-offs. Its printer has a TEST-NET address (192.0.2.10), so collection fails without reaching a real printer.

To use the same ledger for UI work with hot reload:

```sh
PRINTTALLY_MEMORY_SECRETS=1 bun apps/server/src/cli.ts serve --port 4400 --data-dir <that folder>
PRINTTALLY_API=http://127.0.0.1:4400 bun run dev:web
```

### App icon

The app doesn't have an icon yet, so it uses Electron's default.

## Version labels

Settings shows each part's own version in the Computer card:

- **App version** is the desktop app's version. On a release build it's the release version. On a local build it's `<version>-local+<git hash>[-dirty].<UTC timestamp>`, such as `0.1.0-local+e5867d19-dirty.20260930T132341Z`. `-dirty` means the checkout had uncommitted changes, and the timestamp tells apart rebuilds of the same checkout. When run from source it's `<version>-dev`.
- **Backend version** is the version of the server the UI is connected to: the `printtally` package version, from `GET /api/v1/health`. A browser only shows this one. A released app packages a published backend release, so its embedded server always reports a published version.

## npm package

`bun run pack:server` writes `release/printtally-<version>.tgz`. It contains the CLI bundled into one file (`dist/cli.js`, with the workspace packages included) and the UI in `dist/client`. To try it before publishing, run `bun add <path to the .tgz>` in an empty folder. Then run `bunx printtally serve --port 4401 --data-dir <temp folder>`.

## Related

- [Releasing](release.md)
- [Architecture](../ARCHITECTURE.md)
