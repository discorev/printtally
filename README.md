# Print Tally

Print Tally keeps a permanent record of every print from a Canon imagePROGRAF
printer: the ink used on each channel, the paper, the size and when it was printed.
Record what you paid for paper and ink, and it works out what each print cost.

## Why it exists

Canon's own Accounting Manager does not run on macOS 27. Print Tally reads the same
job history directly from the printer over the network, so it needs no Canon
software. The printer only keeps a limited number of recent jobs (220 on the
PRO-1100); Print Tally keeps every job it has ever collected.

## Supported printers and systems

Tested on the imagePROGRAF PRO-1100 under macOS. See
[COMPATIBILITY.md](COMPATIBILITY.md) for tested printers, firmware and operating
systems, and how to report a new one.

## Getting started

You need the printer on your network with a fixed IP address, and the printer's
administrator password. Then either:

- run `bunx printtally` (needs [Bun](https://bun.sh) 1.3.9 or newer), which starts
  Print Tally and opens it in your browser, or
- install the Print Tally desktop app for Macs with Apple silicon: open the `.dmg`,
  drag Print Tally to Applications and open it. It includes everything it needs,
  so you don't need Bun.

Both show the same setup screen:

1. Find your printer, or type its IP address.
2. Compare the certificate fingerprint Print Tally shows with the one on the
   printer's control panel (**Printer information > System information > Root cert.
   thumbprint (SHA-256)**), and confirm only if they match.
3. Enter the administrator password. It's kept in your system's credential store
   (Keychain on macOS), never in a file.

Your jobs appear straight away. From then on, Print Tally collects new jobs when it
starts and every 15 minutes while it's running. If more jobs were printed than the
printer keeps while Print Tally wasn't running, the Jobs screen says which ones may
have been missed.

Running `printtally` again, or opening the desktop app while it's running, uses the
Print Tally that's already running on this computer, so there's only ever one ledger.
It uses port 4318; if another program has that port, Print Tally stops with an error
rather than picking a different one. Use `--port` to choose another.

Print Tally keeps its ledger in a data folder:
`~/Library/Application Support/printtally` on macOS, `~/.printtally` on Linux and
`%APPDATA%\printtally` on Windows (`--data-dir` to use another).

### Commands

| Command | What it does |
|---|---|
| `printtally` | Opens Print Tally in your browser, starting it if it isn't running |
| `printtally serve [--host]` | Runs Print Tally without opening a browser; `--host` lets other devices pair with it |
| `printtally pair [--label NAME]` | Makes a single-use pairing link and QR code for another device |
| `printtally sessions` | Lists paired devices; `printtally sessions revoke <id>` unpairs one |
| `printtally collect` | Collects new jobs from your printers now |

### Moving from an earlier version

`printer.json`, the certificate file and the `probe`, `password`, `import`,
`annotate` and `summary` commands are gone. Your ledger is kept; set the printer up
again in the setup screen and enter its password there. Back up the data folder
first: the upgrade rebuilds some of the ledger's tables the first time it runs. The old Keychain items
(service `print-accounting`, accounts starting `printer:mac:` and `api:`) are no
longer used, and you can delete them in Keychain Access.

## Using Print Tally from other devices

Keep Print Tally running on a computer that stays near the printer, and use it from
your other devices:

```sh
printtally serve --host
```

This prints the addresses other devices can use, and a warning that Print Tally is
now reachable from your network. On the host, make a pairing link for each device:

```sh
printtally pair --label "iPad"
```

Open the link, or scan the QR code, on the device. It works once and expires after
5 minutes; the device then stays signed in until you revoke it with
`printtally sessions revoke <id>`. On a Mac with the desktop app, open the
`printtally://` link it prints instead, or choose "Connect to it" on the setup screen.

Other devices can use any name for the host that resolves to one of its own
addresses, as well as the addresses it prints. With [Tailscale](https://tailscale.com),
both its 100.x address and its MagicDNS name (such as
`http://studio-mac.your-tailnet.ts.net:4318`) work.

Print Tally doesn't encrypt traffic between devices. Use remote access only on a
network you trust, such as your home network, or across
[Tailscale](https://tailscale.com), which encrypts it for you. Never forward the port
to the internet. Remote access is off unless you start the host with `--host`, and
the desktop app never offers it.

## Development

```sh
bun install
bun run typecheck && bun test
```

`bun run dev` runs the server and the web UI with hot reload, and
`bun run dev:desktop` the desktop app; both use your real data folder and port 4318.
For UI work, use a throwaway ledger instead:

```sh
bun run seed:dev                    # or: bun run seed:dev path/to/a-copy-of/jobs.json
PRINTTALLY_MEMORY_SECRETS=1 bun apps/server/src/cli.ts serve --port 4400 --data-dir <folder it printed>
PRINTTALLY_API=http://127.0.0.1:4400 bun run dev:web
```

The seed imports a snapshot (the synthetic `tests/fixtures/reference.json` by
default) and adds papers, stock items (including a deckle sheet and a roll),
purchases, ink cartridges and write-offs. Its printer is at a TEST-NET address
(192.0.2.10), so collection fails without reaching a real printer.
`PRINTTALLY_MEMORY_SECRETS=1` keeps printer passwords in memory instead of Keychain;
use it only for development.

`bun run build:web` builds the UI into `apps/web/dist`, which the server serves
when run from source.

### Packaging

| Command | Builds |
|---|---|
| `bun run pack:server` | The `printtally` package, `release/printtally-<version>.tgz`: the CLI bundled into one file (`dist/cli.js`, workspace packages included) and the UI in `dist/client` |
| `bun run build:server` | The server compiled for macOS arm64, `apps/server/dist/printtally-server`, with the UI in `client/` beside it |
| `bun run dist:desktop` | `build:server`, then the desktop app: `apps/desktop/release/mac-arm64/Print Tally.app` and `Print Tally-<version>-arm64.dmg`, signed with the Developer ID Application certificate in your keychain and not notarized |

Try the package before publishing it: `bun add <path to the .tgz>` in an empty
folder, then run `bunx printtally serve --port 4401 --data-dir <temp folder>`.

### Releasing

Notarization sends the app to Apple, so it only happens when you run the release
command. Once per Mac, save an app-specific password for notarytool in the keychain:

```sh
xcrun notarytool store-credentials printtally-notary --apple-id <your Apple ID> --team-id D6AAJCLH87
```

Then build, sign, notarize and staple the app:

```sh
APPLE_KEYCHAIN_PROFILE=printtally-notary bun run release:desktop
```

The `.dmg` is signed but not notarized by that step; notarize and staple it too:

```sh
xcrun notarytool submit "apps/desktop/release/Print Tally-0.1.0-arm64.dmg" --keychain-profile printtally-notary --wait
xcrun stapler staple "apps/desktop/release/Print Tally-0.1.0-arm64.dmg"
spctl -a -vv -t open --context context:primary-signature "apps/desktop/release/Print Tally-0.1.0-arm64.dmg"
```

Publish the package with `bun publish` in `apps/server` (it builds first).

## Licence and disclaimer

Released under the [MIT License](LICENSE).

Print Tally is an independent project. It is not affiliated with, endorsed by or
sponsored by Canon Inc. or its subsidiaries. Canon, imagePROGRAF and related marks
are trademarks of Canon Inc., used here only to identify compatible printers.
Canon software is not included or required. The printer protocol was implemented
for interoperability. Use it at your own risk: it is provided without warranty,
and ink, paper and cost figures should be checked before billing or accounting
decisions rely on them.
