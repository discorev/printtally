// Packs apps/server the way the release workflow does (`bun pm pack`) and checks the archive is the
// printtally package: its manifest, the bundled CLI and the built UI, with no workspace: ranges left.
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

async function run(command: string[], cwd: string): Promise<string> {
  const process = Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`${command.join(' ')} failed (${exitCode}): ${stderr || stdout}`);
  return stdout;
}

const repositoryRoot = resolve(import.meta.dir, '..');
const serverRoot = resolve(repositoryRoot, 'apps/server');
const destination = await mkdtemp(resolve(tmpdir(), 'printtally-pack-'));

try {
  await run(['bun', 'pm', 'pack', '--destination', destination], serverRoot);
  const archives = (await readdir(destination)).filter(name => name.endsWith('.tgz'));
  if (archives.length !== 1 || !archives[0]) throw new Error(`Expected one packed archive, found ${archives.length}.`);
  const archive = resolve(destination, archives[0]);

  const listing = (await run(['tar', '-tzf', archive], repositoryRoot)).split('\n');
  for (const file of ['package/package.json', 'package/dist/cli.js', 'package/dist/client/index.html', 'package/README.md', 'package/LICENSE'])
    if (!listing.includes(file)) throw new Error(`Packed archive does not contain ${file}.`);

  const manifest = await run(['tar', '-xzOf', archive, 'package/package.json'], repositoryRoot);
  if (manifest.includes('workspace:')) throw new Error('Packed package.json still has workspace: ranges.');
  const { name, version } = JSON.parse(manifest) as { name: string; version: string };
  if (name !== 'printtally') throw new Error(`Packed package is ${name}, not printtally.`);

  console.log(`Packed package smoke test passed: ${archives[0]} (${name}@${version})`);
} finally {
  await rm(destination, { recursive: true, force: true });
}
