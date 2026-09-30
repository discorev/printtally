import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrations } from '../packages/database/src/migrations.ts';

test('embedded migrations match drizzle/ exactly, so the compiled server migrates like the source', () => {
  assert.deepEqual(migrations, readMigrationFiles({ migrationsFolder: fileURLToPath(new URL('../packages/database/drizzle', import.meta.url)) }));
});
test('apps/server is the published printtally package; the root is a private workspace', () => {
  const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
  const server = read('../apps/server/package.json'), root = read('../package.json');
  assert.deepEqual([server.name, server.version, server.private, server.bin.printtally], ['printtally', '0.1.0', undefined, './dist/cli.js']);
  assert.deepEqual(server.files, ['dist/cli.js', 'dist/client']);
  // Everything is bundled into dist/cli.js; the print-accounting-* workspace packages are never published.
  assert.equal(server.dependencies, undefined);
  assert.equal(root.private, true); assert.notEqual(root.name, 'printtally'); assert.equal(root.bin, undefined);
  assert.match(readFileSync(new URL('../apps/server/src/cli.ts', import.meta.url), 'utf8'), /^#!\/usr\/bin\/env bun\n/);
});
test('the published bundle imports only Bun and Node built-ins, and keeps its bun shebang', () => {
  // The CLI, as the package's build script runs it (Bun.build inside bun test can't resolve packages).
  const build = Bun.spawnSync([process.execPath, 'build', fileURLToPath(new URL('../apps/server/src/cli.ts', import.meta.url)), '--target', 'bun']);
  assert.equal(build.exitCode, 0, build.stderr.toString());
  const code = build.stdout.toString();
  assert.match(code, /^#!\/usr\/bin\/env bun\n/);
  const imports = [...code.matchAll(/(?:^import[^'"]*?from\s*|^import\s*|__require\()["']([^"']+)["']/gm)].map(match => match[1]!);
  assert.ok(imports.includes('bun:sqlite'));
  assert.deepEqual(imports.filter(name => !name.startsWith('bun:') && !isBuiltin(name)), []);
});
test('the desktop build embeds the compiled server and its UI where the app runs them', () => {
  const config = Bun.YAML.parse(readFileSync(new URL('../apps/desktop/electron-builder.yml', import.meta.url), 'utf8')) as { extraResources: { from: string; to: string }[]; mac: { notarize: boolean; hardenedRuntime: boolean } };
  const server = JSON.parse(readFileSync(new URL('../apps/server/package.json', import.meta.url), 'utf8'));
  assert.match(server.scripts['build:binary'], /--outfile dist\/printtally-server$/);
  // src/server-manager.ts runs <resources>/server/printtally-server; static.ts serves client/ beside it.
  assert.deepEqual(config.extraResources, [{ from: '../server/dist/printtally-server', to: 'server/printtally-server' }, { from: '../server/dist/client', to: 'server/client' }]);
  // Local builds never notarize; only `bun run release:desktop` turns it on.
  assert.deepEqual([config.mac.notarize, config.mac.hardenedRuntime], [false, true]);
});
