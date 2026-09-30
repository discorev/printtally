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
  assert.deepEqual([server.name, server.version, server.private, server.bin.printtally], ['printtally', '0.1.0', undefined, './dist/cli.js']);
  assert.deepEqual(server.files, ['dist/cli.js', 'dist/client']);
  // npm metadata for the unscoped public package; no repository until the GitHub repo exists.
  assert.deepEqual([server.publishConfig, server.author, server.license, server.homepage, server.repository],
    [{ access: 'public' }, 'Ollie Hayman', 'MIT', 'https://printtally.ink', undefined]);
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
    appId: string; productName: string; extraResources: { from: string; to: string }[]; mac: { notarize: boolean; hardenedRuntime: boolean; entitlementsInherit: string };
    dmg: { contents: { x: number; y: number; type?: string; path?: string }[]; sign: boolean; artifactName: string };
  };
  const server = JSON.parse(readFileSync(new URL('../apps/server/package.json', import.meta.url), 'utf8'));
  assert.match(server.scripts['build:binary'], /--outfile dist\/printtally-server$/);
  // src/server-manager.ts runs <resources>/server/printtally-server; static.ts serves client/ beside it.
  assert.deepEqual(config.extraResources, [{ from: '../server/dist/printtally-server', to: 'server/printtally-server' }, { from: '../server/dist/client', to: 'server/client' }]);
  // One identity for local and release builds; only the release workflow notarizes, with notarytool.
  assert.deepEqual([config.appId, config.productName], ['com.olliespage.PrintTally', 'Print Tally']);
  assert.deepEqual([config.mac.notarize, config.mac.hardenedRuntime], [false, true]);
  // The embedded Bun server needs the JIT entitlements under the hardened runtime.
  assert.match(readFileSync(new URL(`../apps/desktop/${config.mac.entitlementsInherit}`, import.meta.url), 'utf8'), /com\.apple\.security\.cs\.allow-jit/);
  // The app on the left and Applications on the right, where assets/dmg/background.svg draws the arrow between them.
  assert.deepEqual(config.dmg.contents, [{ x: 165, y: 190 }, { x: 495, y: 190, type: 'link', path: '/Applications' }]);
  assert.match(readFileSync(new URL('../assets/dmg/background.svg', import.meta.url), 'utf8'), /viewBox="0 0 660 400"/);
  // scripts/make-dmg.sh signs the .dmg; the release workflow uploads PrintTally-<version>.dmg.
  assert.deepEqual([config.dmg.sign, config.dmg.artifactName], [false, 'PrintTally-${version}.${ext}']);
});

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const json = (path: string) => JSON.parse(read(path));
interface ReleaseConfig { packages: Record<string, { component: string; 'release-type': string; 'initial-version': string; 'changelog-path': string; 'exclude-paths': string[]; 'extra-files': { type: string; path: string; jsonpath: string }[]; 'include-component-in-tag'?: boolean; 'include-v-in-tag'?: boolean; 'tag-separator'?: string }> }

test('release-please releases the app and the backend separately, each counting shared code', () => {
  const components = { app: ['apps/desktop', 'apps/server'], backend: ['apps/server', 'apps/desktop'] } as const;
  for (const [component, [own, other]] of Object.entries(components)) {
    const config = json(`../.github/release-please/${component}.json`) as ReleaseConfig;
    // Rooted at the repository so packages/* and apps/web count; only the other app's own commits are left out.
    assert.deepEqual(Object.keys(config.packages), ['.']);
    const settings = config.packages['.']!;
    assert.deepEqual([settings.component, settings['exclude-paths']], [component, [other]]);
    assert.deepEqual(settings['extra-files'], [{ type: 'json', path: `${own}/package.json`, jsonpath: '$.version' }]);
    assert.equal(settings['changelog-path'], `${own}/CHANGELOG.md`);
    // Tags are <component>-v<version> (release-please's defaults), starting at 0.1.0.
    assert.deepEqual([settings['include-component-in-tag'], settings['include-v-in-tag'], settings['tag-separator']], [undefined, undefined, undefined]);
    assert.equal(`${settings.component}-v${settings['initial-version']}`, `${component}-v0.1.0`);
    assert.deepEqual(json(`../.github/release-please/${component}.manifest.json`), { '.': '0.0.0' });
    assert.equal(json(`../${own}/package.json`).version, '0.1.0');
  }
  assert.equal(json('../apps/server/package.json').name, 'printtally');
});

interface Step { id?: string; uses?: string; run?: string; with?: Record<string, string> }
interface Job { needs?: string | string[]; if?: string; 'runs-on': string; environment?: string; permissions?: Record<string, string>; outputs?: Record<string, string>; steps: Step[] }
interface Workflow { on: { push?: { branches: string[] }; pull_request?: unknown }; jobs: Record<string, Job> }

test('the release workflow builds each component only when release-please released it', () => {
  const workflow = Bun.YAML.parse(read('../.github/workflows/release.yml')) as Workflow;
  assert.deepEqual(workflow.on, { push: { branches: ['main'] } });
  const { 'release-please': releasePlease, app, 'backend-pack': pack, 'backend-publish': publish } = workflow.jobs;
  const steps = Object.fromEntries(releasePlease!.steps.map(step => [step.id, step]));
  for (const component of ['app', 'backend']) {
    assert.match(steps[component]!.uses!, /^googleapis\/release-please-action@/);
    assert.equal(steps[component]!.with!['config-file'], `.github/release-please/${component}.json`);
    assert.equal(steps[component]!.with!['manifest-file'], `.github/release-please/${component}.manifest.json`);
    for (const output of ['release_created', 'tag_name', 'version'])
      assert.equal(releasePlease!.outputs![`${component}_${output.replace('_created', '').replace('_name', '')}`], `\${{ steps.${component}.outputs.${output} }}`);
  }
  assert.deepEqual([app!.if, app!['runs-on'], app!.environment], ["needs.release-please.outputs.app_release == 'true'", 'macos-26', 'release']);
  const appScript = app!.steps.map(step => step.run ?? '').join('\n');
  for (const command of ['PRINTTALLY_RELEASE=1 PRINTTALLY_VERSION="$VERSION" scripts/bundle.sh', 'codesign --verify --deep --strict', 'xcrun notarytool submit', 'xcrun stapler staple "$APP"',
    'spctl --assess --type execute', 'PRINTTALLY_RELEASE=1 scripts/make-dmg.sh', 'xcrun stapler staple "$DMG"', 'gh release upload "$TAG"', 'security delete-keychain'])
    assert.ok(appScript.includes(command), command);
  assert.equal(pack!.if, "needs.release-please.outputs.backend_release == 'true'");
  assert.ok(pack!.steps.some(step => step.run === 'bun pm pack'));
  assert.deepEqual([publish!.needs, publish!.permissions], ['backend-pack', { contents: 'read', 'id-token': 'write' }]);
  assert.ok(publish!.steps.some(step => step.run === 'npm install -g npm@11.5.1 --ignore-scripts'));
});

test('CI runs the checks main requires on pull requests and pushes to main', () => {
  const workflow = Bun.YAML.parse(read('../.github/workflows/ci.yml')) as Workflow;
  assert.deepEqual(workflow.on.push, { branches: ['main'] });
  assert.ok('pull_request' in workflow.on);
  const runs = Object.values(workflow.jobs).flatMap(job => job.steps.map(step => step.run));
  for (const command of ['bun run typecheck', 'bun test', 'bun run test:packed']) assert.ok(runs.includes(command), command);
  const root = json('../package.json');
  assert.equal(root.scripts['dist:desktop'], 'sh scripts/bundle.sh && sh scripts/make-dmg.sh');
  assert.equal(root.scripts['release:desktop'], undefined);
});

bunTest.skipIf(!Bun.which('shellcheck'))('the build scripts pass shellcheck', () => {
  const scripts = ['bundle.sh', 'make-dmg.sh', 'signing.sh'].map(name => fileURLToPath(new URL(`../scripts/${name}`, import.meta.url)));
  const result = Bun.spawnSync(['shellcheck', '-x', ...scripts], { cwd: fileURLToPath(new URL('..', import.meta.url)) });
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr.toString());
});
