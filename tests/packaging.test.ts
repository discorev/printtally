import { test } from 'node:test';
import { test as bunTest } from 'bun:test';
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
  assert.deepEqual([server.name, server.private, server.bin.printtally], ['printtally', undefined, './dist/cli.js']);
  // release-please sets the version; it only has to be a release version that the root package.json shares.
  assert.match(server.version, /^\d+\.\d+\.\d+$/);
  assert.equal(server.version, root.version);
  assert.deepEqual(server.files, ['dist/cli.js', 'dist/client']);
  // npm metadata for the unscoped public package. Trusted publishing checks repository against the workflow's repo.
  assert.deepEqual([server.publishConfig, server.author, server.license, server.homepage, server.repository],
    [{ access: 'public' }, 'Ollie Hayman', 'MIT', 'https://printtally.ink', { type: 'git', url: 'git+https://github.com/discorev/printtally.git', directory: 'apps/server' }]);
  assert.ok(server.engines.bun);
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
  const config = Bun.YAML.parse(readFileSync(new URL('../apps/desktop/electron-builder.yml', import.meta.url), 'utf8')) as {
    appId: string; productName: string; afterPack: string; extraResources: { from: string; to: string }[]; mac: { notarize: boolean; hardenedRuntime: boolean; entitlementsInherit: string; extendInfo: Record<string, unknown> };
    dmg: { contents: { x: number; y: number; type?: string; path?: string }[]; sign: boolean; artifactName: string };
  };
  const server = JSON.parse(readFileSync(new URL('../apps/server/package.json', import.meta.url), 'utf8'));
  assert.match(server.scripts['build:binary'], /--outfile dist\/printtally-server$/);
  // src/server-manager.ts runs <resources>/server/printtally-server; static.ts serves client/ beside it.
  assert.deepEqual(config.extraResources, [{ from: '../server/dist/printtally-server', to: 'server/printtally-server' }, { from: '../server/dist/client', to: 'server/client' }]);
  // The afterPack hook stamps the executables' own Mach-O UUIDs (apps/desktop/scripts/macho-uuid.ts) before signing.
  assert.equal(config.afterPack, './scripts/after-pack.mjs');
  assert.match(read('../apps/desktop/scripts/after-pack.mjs'), /macho-uuid\.ts/);
  // One identity for local and release builds; only the release workflow notarizes, with notarytool.
  assert.deepEqual([config.appId, config.productName], ['com.olliespage.PrintTally', 'Print Tally']);
  assert.deepEqual([config.mac.notarize, config.mac.hardenedRuntime], [false, true]);
  // macOS refuses the bundled server's connection to the printer unless the app says why it uses the local network.
  assert.match(String(config.mac.extendInfo.NSLocalNetworkUsageDescription), /printer on the local network/);
  // The embedded Bun server needs the JIT entitlements under the hardened runtime.
  assert.match(readFileSync(new URL(`../apps/desktop/${config.mac.entitlementsInherit}`, import.meta.url), 'utf8'), /com\.apple\.security\.cs\.allow-jit/);
  // The app on the left and Applications on the right, where apps/desktop/assets/dmg/background.svg draws the arrow between them.
  assert.deepEqual(config.dmg.contents, [{ x: 165, y: 190 }, { x: 495, y: 190, type: 'link', path: '/Applications' }]);
  assert.match(readFileSync(new URL('../apps/desktop/assets/dmg/background.svg', import.meta.url), 'utf8'), /viewBox="0 0 660 400"/);
  // apps/desktop/scripts/make-dmg.sh signs the .dmg; the release workflow uploads PrintTally-<version>.dmg.
  assert.deepEqual([config.dmg.sign, config.dmg.artifactName], [false, 'PrintTally-${version}.${ext}']);
});

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('apps/desktop/scripts/bundle.sh packages a released server when given one, and compiles it otherwise', () => {
  // The release workflow sets PRINTTALLY_SERVER_ARCHIVE to a backend release's server (docs/release.md).
  const script = read('../apps/desktop/scripts/bundle.sh');
  assert.match(script, /if \[ -n "\$SERVER_ARCHIVE" \]; then\n(?:.*\n)*?\s+tar -xzf "\$SERVER_ARCHIVE" -C apps\/server\/dist printtally-server client\nelse\n\s+bun run build:server\nfi\n/);
});

interface Workflow { on: { push?: { branches: string[] }; pull_request?: unknown }; jobs: Record<string, { steps: { uses?: string; run?: string; with?: Record<string, string> }[] }> }

test('CI runs the checks main requires on pull requests and pushes to main, with the pinned Bun', () => {
  const workflow = Bun.YAML.parse(read('../.github/workflows/ci.yml')) as Workflow;
  assert.deepEqual(workflow.on.push, { branches: ['main'] });
  assert.ok('pull_request' in workflow.on);
  const steps = Object.values(workflow.jobs).flatMap(job => job.steps);
  for (const command of ['bun run typecheck', 'bun test', 'bun run test:packed']) assert.ok(steps.some(step => step.run === command), command);
  for (const step of steps.filter(step => step.uses?.startsWith('oven-sh/setup-bun@'))) assert.equal(step.with?.['bun-version'], '1.3.9');
  const root = JSON.parse(read('../package.json'));
  assert.equal(root.scripts['dist:desktop'], 'sh apps/desktop/scripts/bundle.sh && sh apps/desktop/scripts/make-dmg.sh');
  assert.equal(root.scripts['release:desktop'], undefined);
});

bunTest.skipIf(!Bun.which('shellcheck'))('the build scripts pass shellcheck', () => {
  const scripts = ['bundle.sh', 'make-dmg.sh', 'signing.sh'].map(name => fileURLToPath(new URL(`../apps/desktop/scripts/${name}`, import.meta.url)));
  const result = Bun.spawnSync(['shellcheck', '-x', ...scripts], { cwd: fileURLToPath(new URL('..', import.meta.url)) });
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr.toString());
});
