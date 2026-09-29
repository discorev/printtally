import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrations } from '../packages/database/src/migrations.ts';

test('embedded migrations match drizzle/ exactly, so the compiled server migrates like the source', () => {
  assert.deepEqual(migrations, readMigrationFiles({ migrationsFolder: fileURLToPath(new URL('../packages/database/drizzle', import.meta.url)) }));
});
test('apps/server is the published printtally package; the root is a private workspace', () => {
  const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
  const server = read('../apps/server/package.json'), root = read('../package.json');
  assert.deepEqual([server.name, server.version, server.private, server.bin.printtally], ['printtally', '0.1.0', undefined, './src/cli.ts']);
  assert.equal(root.private, true); assert.notEqual(root.name, 'printtally'); assert.equal(root.bin, undefined);
  assert.match(readFileSync(new URL('../apps/server/src/cli.ts', import.meta.url), 'utf8'), /^#!\/usr\/bin\/env bun\n/);
});
