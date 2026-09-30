// Gives each of the app's executables its own Mach-O UUID (LC_UUID), in place. macOS Local Network privacy tracks
// executables partly by that UUID (Apple's TN3179), and ours would otherwise share it with every other app: the
// main executable and helpers are Electron's, renamed, and the server is the Bun runtime with our code appended.
// Run by the electron-builder afterPack hook (after-pack.mjs), before signing:
//   bun apps/desktop/scripts/macho-uuid.ts <path to Print Tally.app> <app version>
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const MH_MAGIC_64 = 0xfeedfacf, MH_CIGAM_64 = 0xcffaedfe, FAT_MAGIC = 0xcafebabe, FAT_MAGIC_64 = 0xcafebabf;
const LC_UUID = 0x1b, MACH_HEADER_64_SIZE = 32;
export const BUNDLE_ID = 'com.olliespage.PrintTally';
// Fixed namespace for Print Tally's executable UUIDs; changing it changes every UUID.
const NAMESPACE = '5f0c1a52-8f3e-4d6b-9a41-7c2e0b9d6e13';

/** The offset of the 16-byte LC_UUID payload in the thin 64-bit Mach-O at `start` in `bytes`. */
function uuidOffset(bytes: Uint8Array, start: number, label: string): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = start + 4 <= bytes.byteLength ? view.getUint32(start, true) : 0;
  if (magic !== MH_MAGIC_64 && magic !== MH_CIGAM_64) throw new Error(`${label}: not a 64-bit Mach-O (magic 0x${magic.toString(16)})`);
  if (start + MACH_HEADER_64_SIZE > bytes.byteLength) throw new Error(`${label}: truncated Mach-O header`);
  const little = magic === MH_MAGIC_64;
  const ncmds = view.getUint32(start + 16, little);
  let offset = start + MACH_HEADER_64_SIZE, found: number | undefined;
  for (let i = 0; i < ncmds; i++) {
    if (offset + 8 > bytes.byteLength) throw new Error(`${label}: truncated load commands`);
    const cmd = view.getUint32(offset, little), size = view.getUint32(offset + 4, little);
    if (size < 8) throw new Error(`${label}: malformed load command ${i}`);
    if (cmd === LC_UUID) {
      if (found !== undefined) throw new Error(`${label}: more than one LC_UUID`);
      if (size < 24 || offset + 24 > bytes.byteLength) throw new Error(`${label}: truncated LC_UUID`);
      found = offset + 8;
    }
    offset += size;
  }
  if (found === undefined) throw new Error(`${label}: no LC_UUID`);
  return found;
}

/** Each slice of a thin 64-bit or fat Mach-O: its offset and, in a fat file, its CPU type, which tells slices apart. */
function slices(bytes: Uint8Array, label: string): { start: number; arch: string }[] {
  if (bytes.byteLength < 8) throw new Error(`${label}: too short to be a Mach-O`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, false);
  if (magic !== FAT_MAGIC && magic !== FAT_MAGIC_64) return [{ start: 0, arch: '' }];
  const wide = magic === FAT_MAGIC_64, count = view.getUint32(4, false), entry = wide ? 32 : 20;
  if (count === 0 || 8 + count * entry > bytes.byteLength) throw new Error(`${label}: malformed fat header`);
  return Array.from({ length: count }, (_, i) => {
    const at = 8 + i * entry;
    const start = wide ? Number(view.getBigUint64(at + 8, false)) : view.getUint32(at + 8, false);
    return { start, arch: `${view.getUint32(at, false)}.${view.getUint32(at + 4, false)}` };
  });
}

const formatUuid = (bytes: Uint8Array): string => {
  const hex = Buffer.from(bytes).toString('hex').toUpperCase();
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
};

/** The UUID of each slice, formatted as dwarfdump prints them. */
export function readUuids(bytes: Uint8Array, label = 'Mach-O'): string[] {
  return slices(bytes, label).map(({ start }) => {
    const at = uuidOffset(bytes, start, label);
    return formatUuid(bytes.subarray(at, at + 16));
  });
}

/** A name-based (version 5 style, SHA-1) UUID for `parts` in Print Tally's namespace. */
export function deterministicUuid(parts: readonly string[]): Uint8Array {
  const hash = createHash('sha1').update(Buffer.from(NAMESPACE.replaceAll('-', ''), 'hex')).update(parts.join('\0')).digest();
  const uuid = new Uint8Array(hash.subarray(0, 16));
  uuid[6] = (uuid[6]! & 0x0f) | 0x50;
  uuid[8] = (uuid[8]! & 0x3f) | 0x80;
  return uuid;
}

/** Rewrites the LC_UUID of every slice in `bytes` to the UUID for `parts` (plus the slice's CPU type in a fat file). */
export function stampUuids(bytes: Uint8Array, parts: readonly string[], label = 'Mach-O'): string[] {
  // Find every LC_UUID before changing any, so a bad slice leaves the file untouched.
  const targets = slices(bytes, label).map(({ start, arch }) => ({ at: uuidOffset(bytes, start, label), arch }));
  return targets.map(({ at, arch }) => {
    const uuid = deterministicUuid(arch ? [...parts, arch] : parts);
    bytes.set(uuid, at);
    return formatUuid(uuid);
  });
}

/** The executables macOS attributes network use to: the main executable, each helper's, and the bundled server. */
export function appExecutables(app: string): string[] {
  const contents = join(app, 'Contents');
  const inDir = (dir: string) => readdirSync(dir).map(name => join(dir, name));
  const helpers = inDir(join(contents, 'Frameworks')).filter(path => /Helper.*\.app$/.test(path)).sort()
    .flatMap(helper => inDir(join(helper, 'Contents', 'MacOS')));
  const executables = [...inDir(join(contents, 'MacOS')), ...helpers, join(contents, 'Resources', 'server', 'printtally-server')];
  const missing = executables.filter(path => !existsSync(path));
  if (missing.length || !helpers.length) throw new Error(`Missing executables in ${app}: ${missing.join(', ') || 'no helpers'}`);
  return executables;
}

/**
 * The version and build a set of UUIDs is derived from. A local build's version (apps/desktop/scripts/bundle.sh) is
 * `<version>-local+<label>.<timestamp>`: its label (the commit, maybe `-dirty`) identifies the build, and the
 * timestamp is left out so rebuilding a checkout gives the same UUIDs. Otherwise the build is the git commit.
 */
export function buildIdentity(version: string, commit: () => string): { version: string; build: string } {
  const local = /^(.+)-local\+([^.]+)\.\d{8}T\d{6}Z$/.exec(version);
  if (local) return { version: local[1]!, build: local[2]! };
  const build = commit().trim();
  if (!build) throw new Error('No git commit to derive the executable UUIDs from');
  return { version, build };
}

/** Stamps each executable in `app` with its own UUID, derived from its path in the bundle, the version and build. */
export function stampApp(app: string, identity: { version: string; build: string }): { path: string; before: string[]; after: string[] }[] {
  return appExecutables(app).map(file => {
    const path = relative(app, file), bytes = readFileSync(file);
    const before = readUuids(bytes, path);
    const after = stampUuids(bytes, [BUNDLE_ID, path, identity.version, identity.build], path);
    writeFileSync(file, bytes);
    return { path, before, after };
  });
}

if (import.meta.main) {
  const [app, version] = process.argv.slice(2);
  if (!app || !version) throw new Error('Usage: bun macho-uuid.ts <path to the .app> <app version>');
  const identity = buildIdentity(version, () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: import.meta.dir, encoding: 'utf8' }));
  console.log(`Stamping Mach-O UUIDs for ${identity.version} (${identity.build})`);
  for (const { path, before, after } of stampApp(app, identity)) console.log(`  ${path}: ${before.join(',')} -> ${after.join(',')}`);
}
