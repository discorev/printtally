# apps/desktop

The Electron shell for Print Tally (see ../../ARCHITECTURE.md). It never holds
business rules, printer access or the database itself; the renderer is the same
`apps/web` UI, talking HTTP to a server exactly like a browser would.

On launch it finds a server: the saved remote host if one is configured (kept even
when it doesn't answer, with a "Can't reach … retrying" page offering this Mac
instead), else whatever Print Tally answers `GET /api/v1/health` on
`127.0.0.1:4318`; if nothing does, it starts the bundled server itself (in dev,
`bun apps/server/src/cli.ts serve`; in a packaged build, a compiled binary under
`process.resourcesPath` — see `src/server-manager.ts` for the seam step 06 fills
in). It never starts over another app on the port, and it stops after three failed
starts. Every 5 seconds it checks the server: one it started that crashed is
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
