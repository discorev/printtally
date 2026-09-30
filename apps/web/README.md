# apps/web

The single UI for Print Tally, used by both the browser and the Electron desktop
app (see ../../ARCHITECTURE.md). React 19, Vite, TanStack Router (file-based
routes in `src/routes`) and Query, Tailwind v4, Base UI components, lucide icons.

Talks to the server only through the HTTP API, typed by `packages/contracts`.
Never imports `print-accounting-database` or `print-accounting-ivec`.

## Structure

- `src/styles.css`: the docket design's tokens (Tailwind colours such as `bg-paper`, `text-muted`,
  `border-rule`, `bg-mat`; fonts `font-slab`/`font-sans`/`font-mono`; light and dark follow the system),
  bundled fonts, and the `phone:` (< 900px), `narrow:` (900–1100px) and `desktop:` (inside Electron) variants.
- `src/components`: the shared components (`index.ts`). Anything on more than one screen lives here.
- `src/api`: the typed client (`endpoints.ts`), TanStack Query hooks and `useEdit` for mutations (`queries.ts`).
- `src/connection`: the connection monitor (server lost → banner, read-only, retry with backoff), `useCanEdit()`.
- `src/shell`: top bar, bottom nav, banners, and redirects (401 → `/connect`, no printer → `/setup`).
- `src/routes`: file-based routes; selection is in the URL (`/jobs/71`, `/papers/3`, `/papers/media/<id>`, `/ink/MBK`).
- `src/desktop.ts`: the Electron preload bridge (`window.printtally`), absent in browsers.

## Develop

`bun run dev` from the repo root starts this dev server together with the API
server. Requests to `/api` are proxied to the server (default
`http://127.0.0.1:4318`, override with `PRINTTALLY_API`), and edits from pages
this dev server serves carry the API's own origin, which the API requires
(`dev-proxy.ts`). The dev server listens on `127.0.0.1:5173` only.

To run just this app: `bun run --cwd apps/web dev`.

## Build

`bun run --cwd apps/web build` produces `dist/`, which `apps/server` serves in
production (falling back to `../web/dist` when run from source).
