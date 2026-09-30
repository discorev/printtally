# apps/desktop

The Electron shell for Print Tally (see ../../ARCHITECTURE.md). It never holds
business rules, printer access or the database itself; the renderer is the same
`apps/web` UI, talking HTTP to a server exactly like a browser would.

On launch it finds a server: the saved remote host if one is configured (kept even
when it doesn't answer, with a "Can't reach … retrying" page offering this Mac
instead), else whatever Print Tally answers `GET /api/v1/health` on
`127.0.0.1:4318`; if nothing does, it starts the bundled server itself (in dev,
`bun apps/server/src/cli.ts serve`; in the packaged app, the compiled server at
`Contents/Resources/server/printtally-server`, which serves the UI from `client/`
beside it). It never starts over another app on the port, and it stops (showing a problem page)
after three failed starts, counting a server that exits within 30 seconds of starting. Every 5 seconds it checks the server: one it started that crashed is
restarted, and one it only borrowed that disappeared is taken over on the same port
and data folder. A remote host answering 401 counts as up: the window holds the
session, and the UI handles signing in again.

`printtally://<host>:<port>/pair#code=…` links from `printtally pair` open the app,
remember the host and port, and load the host's `/pair` page in the window, which
redeems the code for the window's session cookie. The renderer can switch computer
with a pairing link, an address, or nothing for this Mac.

Closing the window keeps the app in the Dock; only quitting stops a server it
owns. `contextIsolation` is on, `nodeIntegration` is off, `sandbox` is on; the
preload script (`src/preload.cts`, CommonJS because a sandboxed preload can't be an
ES module) exposes only connection info and "switch computer" to the renderer. The
window only navigates within the connected server's origin and opens no new windows.

## Develop

`bun run dev:desktop` from the repo root starts the `apps/web` dev server and
this app together, and Ctrl+C stops both; the window loads the Vite dev URL,
`http://127.0.0.1:5173` (override with `PRINTTALLY_WEB_URL`), unless it is
connected to a remote host, whose own UI it loads. In production it loads the connected server's own URL,
which serves the built UI.

To run just this app against an already-running web dev server:
`bun run --cwd apps/desktop dev`.

## Package

`bun run dist:desktop` from the repo root compiles the server
(`apps/server/dist/printtally-server` and its `client/`), then runs electron-builder
(`electron-builder.yml`) to make `release/mac-arm64/Print Tally.app` and
`release/Print Tally-<version>-arm64.dmg` for Apple silicon. The app id is
`com.olliespage.PrintTally`; the compiled server goes in `Contents/Resources/server/`.

It signs with the Developer ID Application identity in your keychain (set
`CSC_NAME` to choose one) under the hardened runtime. `build/entitlements.mac.plist`
is the app's; `build/entitlements.mac.inherit.plist` covers Electron's helpers and
the embedded Bun server, which needs `allow-jit` to run at full speed. Local builds
are never notarized; `bun run release:desktop` is (see the root README).

A packaged build always uses port 4318 and the default data folder, so opening it
uses your real ledger. `PRINTTALLY_PORT` and `PRINTTALLY_DATA_DIR` work only in
development (`bun run dev:desktop`), where they keep you off the real ledger and port;
a packaged app ignores them so it can never start a second ledger by accident.

Quitting the app stops the server it started. The app's own settings (the saved
remote host) live in `~/Library/Application Support/Print Tally`, apart from the
ledger's data folder.
