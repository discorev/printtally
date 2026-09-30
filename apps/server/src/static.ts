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
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pair with Print Tally</title>
<style>
:root{--mat:#37665A;--grid:rgba(255,255,255,.075);--grid5:rgba(255,255,255,.14);--paper:#FAF9F6;--ink:#1B1D1C;--muted:#5E6561;--rule:#B8B5AC;--amber:#9E6A12;--shadow:0 1px 0 rgba(0,0,0,.28),0 10px 28px rgba(0,0,0,.24);color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--mat:#182320;--grid:rgba(255,255,255,.045);--grid5:rgba(255,255,255,.085);--paper:#232624;--ink:#ECEAE3;--muted:#A5AAA3;--rule:#535852;--amber:#E2AB4B;--shadow:0 1px 0 rgba(0,0,0,.6),0 12px 30px rgba(0,0,0,.5)}}
html,body{height:100%;margin:0}
body{display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;color:var(--ink);font:400 14px/20px "Public Sans",-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased;
  background-color:var(--mat);background-position:-1px -1px;background-size:100px 100px,100px 100px,20px 20px,20px 20px;
  background-image:linear-gradient(var(--grid5) 1px,transparent 1px),linear-gradient(90deg,var(--grid5) 1px,transparent 1px),linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px)}
main{width:600px;max-width:100%;background:var(--paper);border-radius:3px;box-shadow:var(--shadow)}
header{padding:16px 20px 12px;border-bottom:1px solid var(--rule)}
.lab{font:600 11px/16px "Zilla Slab","Iowan Old Style",Georgia,serif;text-transform:uppercase;letter-spacing:.09em;color:var(--muted)}
h1{margin:4px 0 0;font:500 20px/26px "Zilla Slab","Iowan Old Style",Georgia,serif}
p{margin:0;padding:14px 20px 16px;font-size:13px;line-height:18px;color:var(--muted)}
p.problem{color:var(--amber)}
code{font:12.5px ui-monospace,"SF Mono",Menlo,Consolas,monospace}
</style></head>
<body><main><header><div class="lab">Print Tally</div><h1>Pair this device</h1></header><p id="message" role="status">Pairing this device…</p></main>
<script>
const code = new URLSearchParams(location.hash.slice(1)).get('code'), message = document.getElementById('message');
history.replaceState(null, '', '/pair');
const problem = text => { message.className = 'problem'; message.innerHTML = text; };
const again = ' Run <code>printtally pair</code> on the host for a new one.';
if (!code) problem('This pairing link is incomplete.' + again);
else fetch('/api/v1/pairing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
  .then(response => { if (response.ok) location.replace('/'); else problem('This pairing link has expired or was already used.' + again); })
  .catch(() => { problem("Can't reach Print Tally. Check this device is on the same network as the host."); });
</script></body></html>
`;
