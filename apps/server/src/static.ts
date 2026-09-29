import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';

// The built UI: dist/client beside the published package, ../web/dist when run from source, or
// client/ beside a compiled server binary. Hashed files under assets/ are cached for good.
export function uiDirectory(candidates = [join(import.meta.dir, '..', 'dist', 'client'), join(import.meta.dir, '..', '..', 'web', 'dist'), join(dirname(process.execPath), 'client')]): string | undefined {
  return candidates.find(directory => existsSync(join(directory, 'index.html')));
}
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.map': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
};
export interface StaticFile { status: number; type: string; cache: string; body: Buffer }
const missing = (text: string): StaticFile => ({ status: 404, type: 'text/plain; charset=utf-8', cache: 'no-store', body: Buffer.from(text) });
// Paths without an extension are app routes and get index.html (SPA fallback); dotfiles and
// anything outside the UI folder are never served.
export function staticFile(root: string | undefined, pathname: string): StaticFile {
  if (!root) return missing('The Print Tally UI has not been built. Run `bun run build:web`, then restart the server.\n');
  let path: string;
  try { path = decodeURIComponent(pathname); } catch { return missing('Not found\n'); }
  if (path.includes('\0') || path.split('/').some(part => part.startsWith('.'))) return missing('Not found\n');
  const base = resolve(root), file = resolve(base, '.' + path);
  if (file !== base && !file.startsWith(base + sep)) return missing('Not found\n');
  const exists = existsSync(file) && statSync(file).isFile();
  if (!exists && extname(file)) return missing('Not found\n');
  const target = exists ? file : join(base, 'index.html'), type = types[extname(target).toLowerCase()] ?? 'application/octet-stream';
  const immutable = exists && path.startsWith('/assets/');
  return { status: 200, type, cache: immutable ? 'public, max-age=31536000, immutable' : 'no-cache', body: readFileSync(target) };
}
// Opened from `printtally pair`. The code travels in the fragment, so it never reaches logs or
// link previews; the page exchanges it once for the session cookie, then opens the app.
export const pairPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pair with Print Tally</title></head>
<body style="font:16px/1.5 system-ui,sans-serif;max-width:30rem;margin:4rem auto;padding:0 1rem"><h1 style="font-size:1.25rem">Print Tally</h1><p id="message">Pairing this device…</p>
<script>
const code = new URLSearchParams(location.hash.slice(1)).get('code'), message = document.getElementById('message');
history.replaceState(null, '', '/pair');
if (!code) message.textContent = 'This pairing link is incomplete. Run printtally pair on the host for a new one.';
else fetch('/api/v1/pairing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
  .then(response => { if (response.ok) location.replace('/'); else message.textContent = 'This pairing link has expired or was already used. Run printtally pair on the host for a new one.'; })
  .catch(() => { message.textContent = "Can't reach Print Tally. Check this device is on the same network as the host."; });
</script></body></html>
`;
