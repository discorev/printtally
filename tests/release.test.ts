// The trunk-based release setup (docs/release.md): release-please's config, proven by running release-please
// itself offline against a fake GitHub, and the release workflow's job graph.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Manifest, setLogger, type GitHub } from 'release-please';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const json = (path: string) => JSON.parse(read(path));
const CONFIG = '.github/release-please/config.json', MANIFEST = '.github/release-please/manifest.json';

interface Commit { message: string; files: string[] }
interface Released { backend: string; app: string }

// Just enough of release-please's GitHub client for Manifest.buildPullRequests: the files on main, the releases
// and tags so far, and the commits since them (newest first, ending at the last release PR's merge).
function fakeGitHub(released: Released | undefined, commits: Commit[]): GitHub {
  const versions: Record<string, string | undefined> = { 'package.json': released?.backend, 'apps/server/package.json': released?.backend, 'apps/desktop/package.json': released?.app };
  const contents = (path: string) => {
    // Before any release the manifest holds 0.0.0 for both, whatever the repo's own manifest says by now.
    let text = path === MANIFEST ? JSON.stringify({ '.': released?.backend ?? '0.0.0', 'apps/desktop': released?.app ?? '0.0.0' }) : read(path);
    if (versions[path]) text = JSON.stringify({ ...JSON.parse(text), version: versions[path] }, null, 2);
    return { sha: path, content: Buffer.from(text).toString('base64'), parsedContent: text, mode: '100644' };
  };
  const tags = released ? [`backend-v${released.backend}`, `app-v${released.app}`] : [];
  const releaseCommit = { sha: 'release', message: 'chore: release main', files: [MANIFEST], pullRequest: { number: 1, title: 'chore: release main', body: '', labels: [], files: [], headBranchName: 'release-please--branches--main', baseBranchName: 'main' } };
  return {
    repository: { owner: 'discorev', repo: 'printtally', defaultBranch: 'main' },
    getFileContentsOnBranch: async (path: string) => contents(path),
    getFileJson: async (path: string) => JSON.parse(contents(path).parsedContent),
    async *releaseIterator() { for (const tagName of tags) yield { name: tagName, tagName, sha: 'release', notes: '' }; },
    async *tagIterator() { for (const name of tags) yield { name, sha: 'release' }; },
    async *mergeCommitIterator() {
      yield* commits.map((commit, index) => ({ sha: `c${index}`, ...commit }));
      if (released) yield releaseCommit;
    },
  } as unknown as GitHub;
}

// The release PRs release-please would open: for each, the version of each component, and what it writes into
// the files that carry them.
async function releasePullRequests(released: Released | undefined, commits: Commit[]) {
  setLogger({ error() {}, warn() {}, info() {}, debug() {}, trace() {} });
  const github = fakeGitHub(released, commits);
  const manifest = await Manifest.fromManifest(github, 'main', CONFIG, MANIFEST);
  const pullRequests = await manifest.buildPullRequests();
  return Promise.all(pullRequests.map(async pullRequest => {
    const files: Record<string, unknown> = {};
    for (const path of ['package.json', 'apps/server/package.json', 'apps/desktop/package.json', MANIFEST]) {
      let content = (await github.getFileContentsOnBranch(path, 'main')).parsedContent;
      for (const update of pullRequest.updates.filter(update => update.path === path)) content = update.updater.updateContent(content);
      files[path] = path === MANIFEST ? JSON.parse(content) : JSON.parse(content).version;
    }
    return { versions: Object.fromEntries(pullRequest.body.releaseData.map(data => [data.component, data.version?.toString()])), files };
  }));
}

const released = { backend: '0.4.2', app: '1.3.0' };
const server = { message: 'fix(server): reconnect after the printer sleeps', files: ['apps/server/src/collector.ts'] };
const web = { message: 'feat(web): label jobs', files: ['apps/web/src/jobs.tsx'] };
const shared = { message: 'fix(core): round ink costs', files: ['packages/core/src/ledger.ts'] };
const desktop = { message: 'fix(desktop): remember the window size', files: ['apps/desktop/src/main.ts'] };

test('a backend change releases the backend, and the app with it, at their own versions', async () => {
  for (const commit of [server, web, shared]) {
    const [pullRequest, ...rest] = await releasePullRequests(released, [commit]);
    assert.equal(rest.length, 0, commit.message);
    assert.deepEqual(pullRequest!.versions, { backend: commit === web ? '0.5.0' : '0.4.3', app: '1.3.1' }, commit.message);
    // The npm package carries the backend version; the root package.json is the backend's release-please package.
    assert.deepEqual(pullRequest!.files, {
      'package.json': pullRequest!.versions.backend, 'apps/server/package.json': pullRequest!.versions.backend, 'apps/desktop/package.json': '1.3.1',
      [MANIFEST]: { '.': pullRequest!.versions.backend, 'apps/desktop': '1.3.1' },
    }, commit.message);
  }
});

test('a desktop change releases only the app', async () => {
  const pullRequests = await releasePullRequests(released, [desktop]);
  assert.deepEqual(pullRequests.map(pullRequest => pullRequest.versions), [{ app: '1.3.1' }]);
  assert.equal(pullRequests[0]!.files['apps/server/package.json'], '0.4.2');
});

test('a desktop build script change releases only the app, since desktop-only build files live under apps/desktop', async () => {
  const buildScript = { message: 'fix(desktop): tidy the bundle script', files: ['apps/desktop/scripts/bundle.sh'] };
  const pullRequests = await releasePullRequests(released, [buildScript]);
  assert.deepEqual(pullRequests.map(pullRequest => pullRequest.versions), [{ app: '1.3.1' }]);
  assert.equal(pullRequests[0]!.files['apps/server/package.json'], '0.4.2');
});

test('docs, chores and commits outside the apps and packages release nothing', async () => {
  const commits = [
    { message: 'docs: explain releases', files: ['docs/release.md', 'apps/server/README.md'] },
    { message: 'chore(desktop): tidy', files: ['apps/desktop/src/main.ts'] },
    { message: 'fix(ci): pin bun', files: ['.github/workflows/ci.yml'] },
    { message: 'fix: dev-seed.ts', files: ['scripts/dev-seed.ts', 'docs/build.md'] },
    { message: 'test: cover labels', files: ['tests/ledger.test.ts', 'packages/core/src/ledger.test.ts'] },
  ];
  assert.deepEqual(await releasePullRequests(released, commits), []);
});

test('changes to both land in one release PR', async () => {
  const pullRequests = await releasePullRequests(released, [desktop, { ...web, message: 'feat(web)!: new ledger view' }, shared]);
  assert.deepEqual(pullRequests.map(pullRequest => pullRequest.versions), [{ backend: '0.5.0', app: '1.3.1' }]);
});

test('the first release of each is 0.1.0', async () => {
  const pullRequests = await releasePullRequests(undefined, [server, desktop]);
  assert.deepEqual(pullRequests.map(pullRequest => pullRequest.versions), [{ backend: '0.1.0', app: '0.1.0' }]);
});

test('the app release-please package declares that it embeds the backend', () => {
  // node-workspace bumps a package when one it depends on is released. Only the root can count commits to
  // apps/server, apps/web and packages/*, so the backend's release-please package is the root, and the app
  // names it as an optional peer: bun never installs it, and release-please sees the dependency.
  const desktop = json('apps/desktop/package.json'), root = json('package.json');
  assert.deepEqual([desktop.peerDependencies, desktop.peerDependenciesMeta], [{ [root.name]: 'workspace:*' }, { [root.name]: { optional: true } }]);
  assert.equal(root.version, json('apps/server/package.json').version);
});

interface Step { name?: string; id?: string; uses?: string; run?: string; if?: string; with?: Record<string, string>; env?: Record<string, string> }
interface Job { needs?: string | string[]; if?: string; 'runs-on': string; environment?: string; permissions?: Record<string, string>; outputs?: Record<string, string>; env?: Record<string, string>; steps: Step[] }
const workflow = Bun.YAML.parse(read('.github/workflows/release.yml')) as { on: unknown; permissions: unknown; jobs: Record<string, Job> };
const script = (job: Job) => job.steps.map(step => step.run ?? '').join('\n');

test('merging the release PR on main runs release-please, then publishes what it released', () => {
  assert.deepEqual([workflow.on, workflow.permissions], [{
    push: { branches: ['main'] },
    workflow_dispatch: { inputs: { backend_tag: { description: 'Backend tag to publish to npm (e.g. backend-v0.1.0)', required: true } } },
  }, { contents: 'read' }]);
  assert.deepEqual(Object.fromEntries(Object.entries(workflow.jobs).map(([name, job]) => [name, job.needs ?? []])), {
    'release-please': [], 'npm-prepare': 'release-please', 'npm-publish': 'npm-prepare', 'backend-assets': ['release-please', 'npm-prepare'], app: ['release-please', 'backend-assets'],
  });
  const { 'release-please': releasePlease } = workflow.jobs;
  assert.deepEqual(releasePlease!.steps, [{ id: 'release', uses: 'googleapis/release-please-action@v5', with: {
    token: '${{ github.token }}', 'config-file': CONFIG, 'manifest-file': MANIFEST,
  } }]);
  // release-please-action names the root package's outputs plainly and prefixes the others with their path.
  for (const [component, prefix] of [['backend', ''], ['app', 'apps/desktop--']])
    for (const [output, key] of [['release', 'release_created'], ['tag', 'tag_name'], ['version', 'version']])
      assert.equal(releasePlease!.outputs![`${component}_${output}`], prefix ? `\${{ steps.release.outputs['${prefix}${key}'] }}` : `\${{ steps.release.outputs.${key} }}`);
  // release-please-action bundles release-please 17.6.0, the version the tests above run.
  assert.equal(json('package.json').devDependencies['release-please'], '17.6.0');
  for (const job of Object.values(workflow.jobs))
    for (const step of job.steps.filter(step => step.uses?.startsWith('oven-sh/setup-bun@'))) assert.deepEqual(step.with, { 'bun-version': '1.3.9' });
});

test('a backend release is tested and packed unprivileged, then published to npm with OIDC from the release environment', () => {
  const { 'release-please': releasePlease, 'npm-prepare': prepare, 'npm-publish': publish } = workflow.jobs;
  // A manual run stages an already released backend tag again and skips release-please and the app.
  assert.equal(releasePlease!.if, "github.event_name == 'push'");
  assert.deepEqual([prepare!.if, prepare!.env, prepare!.permissions], [
    "${{ !cancelled() && (needs.release-please.outputs.backend_release == 'true' || github.event_name == 'workflow_dispatch') }}",
    { TAG: '${{ inputs.backend_tag || needs.release-please.outputs.backend_tag }}' }, undefined]);
  assert.ok(script(prepare!).includes('VERSION=${TAG#backend-v}'));
  for (const command of ['bun install --frozen-lockfile', 'bun run typecheck && bun test', 'npm view "printtally@$VERSION" version', 'bun pm pack'])
    assert.ok(script(prepare!).includes(command), command);
  assert.deepEqual([publish!.if, publish!.permissions], ["${{ !cancelled() && needs.npm-prepare.outputs.publish == 'true' }}", { contents: 'read', 'id-token': 'write' }]);
  // npm's trusted publisher only accepts the release environment, which only main can deploy to.
  assert.equal(publish!.environment, 'release');
  assert.deepEqual(publish!.steps.flatMap(step => step.run ?? []), ['npm install -g npm@11.21.0 --ignore-scripts', 'npm publish printtally-*.tgz --provenance --ignore-scripts']);
  // The job that can publish pins its actions to commits.
  for (const step of publish!.steps.filter(step => step.uses)) assert.match(step.uses!, /@[0-9a-f]{40}$/);
});

test('a backend release attaches its compiled server, checked and checksummed, for the app to package', () => {
  const { 'backend-assets': assets, app } = workflow.jobs;
  assert.deepEqual([assets!.if, assets!['runs-on'], assets!.permissions], ["needs.release-please.outputs.backend_release == 'true'", 'macos-26', { contents: 'write' }]);
  const build = script(assets!);
  for (const command of ['bun run build:server', 'curl --silent --fail http://127.0.0.1:4411/api/v1/health', '[ "${REPORTED:-}" = "$VERSION" ]',
    'ARCHIVE="printtally-server-$VERSION-darwin-arm64.tar.gz"', 'tar -czf "$ARCHIVE" -C apps/server/dist printtally-server client',
    'shasum -a 256 "$ARCHIVE" > "$ARCHIVE.sha256"', 'gh release upload "$TAG" "$ARCHIVE" "$ARCHIVE.sha256" --clobber'])
    assert.ok(build.includes(command), command);
  // The app takes that server from this release, or for an app-only release, from the latest backend release.
  const download = app!.steps.find(step => step.name === 'Download the backend server')!;
  for (const command of ['SERVER_TAG=$BACKEND_TAG', 'select(startswith("backend-v"))', "gh release download \"$SERVER_TAG\" --dir \"$SERVER_DIR\" --pattern 'printtally-server-*-darwin-arm64.tar.gz*'",
    'ARCHIVE="$SERVER_DIR/printtally-server-${SERVER_TAG#backend-v}-darwin-arm64.tar.gz"', 'shasum -a 256 --check', "printf 'PRINTTALLY_SERVER_ARCHIVE=%s\\n' \"$ARCHIVE\" >> \"$GITHUB_ENV\""])
    assert.ok(download.run!.includes(command), command);
  const names = app!.steps.map(step => step.name);
  assert.ok(names.indexOf('Download the backend server') < names.indexOf('Build signed app'));
});

test('an app release waits for its backend, then signs, notarizes and uploads the app', () => {
  const { app } = workflow.jobs;
  assert.equal(app!.if, "!cancelled() && needs.release-please.outputs.app_release == 'true' && (needs.backend-assets.result == 'success' || (needs.backend-assets.result == 'skipped' && needs.release-please.outputs.backend_release != 'true'))");
  assert.deepEqual([app!['runs-on'], app!.environment, app!.env!.APPLE_TEAM_ID], ['macos-26', 'release', 'D6AAJCLH87']);
  const build = script(app!);
  for (const command of ['security create-keychain', 'PRINTTALLY_RELEASE=1 PRINTTALLY_VERSION="$VERSION" apps/desktop/scripts/bundle.sh', 'codesign --verify --deep --strict',
    'xcrun notarytool submit', 'xcrun stapler staple "$APP"', 'spctl --assess --type execute', 'PRINTTALLY_RELEASE=1 apps/desktop/scripts/make-dmg.sh', 'xcrun stapler staple "$DMG"',
    'spctl --assess --type open', 'gh release upload "$TAG" "apps/desktop/release/PrintTally-$VERSION.dmg" "apps/desktop/release/PrintTally-$VERSION.zip"'])
    assert.ok(build.includes(command), command);
  const cleanup = app!.steps.at(-1)!;
  assert.deepEqual([cleanup.if, cleanup.run?.includes('security delete-keychain "$KEYCHAIN_PATH"')], ['always()', true]);
});
