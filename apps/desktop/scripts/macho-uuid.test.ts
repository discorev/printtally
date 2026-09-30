import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { BUNDLE_ID, buildIdentity, deterministicUuid, readUuids, stampApp, stampUuids } from './macho-uuid.ts';

const OLD_UUID = Array.from({ length: 16 }, (_, i) => 0xa0 + i);

// A minimal 64-bit Mach-O: header, a segment-sized filler command, LC_UUID (unless left out), another command and
// some trailing bytes. Returns the file and the offset of its UUID.
function thin({ little = true, uuid = true } = {}): { bytes: Uint8Array; uuidAt: number } {
  const commands: [number, number][] = [[0x19, 72], ...(uuid ? [[0x1b, 24] as [number, number]] : []), [0x32, 24]];
  const size = 32 + commands.reduce((sum, [, length]) => sum + length, 0) + 40;
  const bytes = new Uint8Array(size).map((_, i) => (i * 7 + 3) & 0xff), view = new DataView(bytes.buffer);
  view.setUint32(0, 0xfeedfacf, little);
  view.setUint32(4, 0x0100000c, little);
  view.setUint32(16, commands.length, little);
  view.setUint32(20, size - 32 - 40, little);
  let offset = 32, uuidAt = -1;
  for (const [cmd, length] of commands) {
    view.setUint32(offset, cmd, little);
    view.setUint32(offset + 4, length, little);
    if (cmd === 0x1b) { uuidAt = offset + 8; bytes.set(OLD_UUID, uuidAt); }
    offset += length;
  }
  return { bytes, uuidAt };
}

// A fat file with the given slices at 256-byte boundaries.
function fat(parts: Uint8Array[]): { bytes: Uint8Array; starts: number[] } {
  const starts = parts.map((_, i) => 256 * (i + 1));
  const bytes = new Uint8Array(256 * (parts.length + 1)).fill(0x5a), view = new DataView(bytes.buffer);
  view.setUint32(0, 0xcafebabe);
  view.setUint32(4, parts.length);
  parts.forEach((part, i) => {
    const at = 8 + i * 20;
    view.setUint32(at, 0x0100000c + i);
    view.setUint32(at + 8, starts[i]!);
    view.setUint32(at + 12, part.byteLength);
    bytes.set(part, starts[i]!);
  });
  return { bytes, starts };
}

const changedOffsets = (before: Uint8Array, after: Uint8Array) => [...before.keys()].filter(i => before[i] !== after[i]);
const range = (start: number) => Array.from({ length: 16 }, (_, i) => start + i);
const parts = [BUNDLE_ID, 'Contents/MacOS/Print Tally', '1.2.3', 'abc123'];

for (const little of [true, false]) {
  test(`stamping a thin ${little ? 'little' : 'big'}-endian Mach-O changes exactly its 16 UUID bytes`, () => {
    const { bytes, uuidAt } = thin({ little });
    const before = bytes.slice();
    expect(readUuids(bytes)).toEqual(['A0A1A2A3-A4A5-A6A7-A8A9-AAABACADAEAF']);
    const [uuid] = stampUuids(bytes, parts);
    const changed = changedOffsets(before, bytes);
    expect(changed.every(i => i >= uuidAt && i < uuidAt + 16)).toBe(true);
    expect(changed.length).toBeGreaterThan(8);
    expect(bytes.subarray(uuidAt, uuidAt + 16)).toEqual(deterministicUuid(parts));
    expect(readUuids(bytes)).toEqual([uuid!]);
  });
}

test('stamping a fat Mach-O changes exactly each slice\'s UUID, and gives each slice its own', () => {
  const { bytes, starts } = fat([thin().bytes, thin({ little: false }).bytes]);
  const uuidAt = thin().uuidAt, before = bytes.slice();
  const uuids = stampUuids(bytes, parts);
  expect(uuids).toHaveLength(2);
  expect(uuids[0]).not.toBe(uuids[1]);
  const allowed = new Set(starts.flatMap(start => range(start + uuidAt)));
  expect(changedOffsets(before, bytes).every(i => allowed.has(i))).toBe(true);
  expect(readUuids(bytes)).toEqual(uuids);
});

test('anything but a 64-bit Mach-O with an LC_UUID fails, and is left untouched', () => {
  const noUuid = thin({ uuid: false }).bytes;
  const mixed = fat([thin().bytes, thin({ uuid: false }).bytes]).bytes;
  const thin32 = thin().bytes; new DataView(thin32.buffer).setUint32(0, 0xfeedface, true);
  const cases: [Uint8Array, RegExp][] = [
    [noUuid, /no LC_UUID/], [mixed, /no LC_UUID/], [thin32, /not a 64-bit Mach-O/],
    [new TextEncoder().encode('#!/bin/sh\necho hello\n'), /not a 64-bit Mach-O/], [new Uint8Array(4), /too short/],
  ];
  for (const [bytes, error] of cases) {
    const before = bytes.slice();
    expect(() => stampUuids(bytes, parts)).toThrow(error);
    expect(bytes).toEqual(before);
  }
});

test('UUIDs are deterministic, and differ for every executable, version and build', () => {
  expect(deterministicUuid(parts)).toEqual(deterministicUuid([...parts]));
  const a = thin().bytes, b = thin().bytes;
  stampUuids(a, parts); stampUuids(b, parts);
  expect(a).toEqual(b);
  const variants = [
    parts,
    [BUNDLE_ID, 'Contents/Resources/server/printtally-server', '1.2.3', 'abc123'],
    [BUNDLE_ID, 'Contents/MacOS/Print Tally', '1.2.4', 'abc123'],
    [BUNDLE_ID, 'Contents/MacOS/Print Tally', '1.2.3', 'abc124'],
    ['com.example.Other', 'Contents/MacOS/Print Tally', '1.2.3', 'abc123'],
  ];
  const uuids = variants.map(variant => Buffer.from(deterministicUuid(variant)).toString('hex'));
  expect(new Set(uuids).size).toBe(variants.length);
});

test('UUIDs are version 5 with the RFC 4122 variant', () => {
  for (const path of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
    const uuid = deterministicUuid([BUNDLE_ID, path, '1.0.0', 'x']);
    expect(uuid).toHaveLength(16);
    expect(uuid[6]! >> 4).toBe(5);
    expect(uuid[8]! & 0xc0).toBe(0x80);
  }
});

test('a local build derives its UUIDs from its label, not its timestamp; a release from the commit', () => {
  const noCommit = () => { throw new Error('should not ask git'); };
  expect(buildIdentity('0.1.1-local+567ee15c-dirty.20260930T184655Z', noCommit)).toEqual({ version: '0.1.1', build: '567ee15c-dirty' });
  expect(buildIdentity('0.1.1-local+567ee15c.20261001T000000Z', noCommit)).toEqual({ version: '0.1.1', build: '567ee15c' });
  expect(buildIdentity('0.1.1', () => 'f57d03c0ffee\n')).toEqual({ version: '0.1.1', build: 'f57d03c0ffee' });
  expect(() => buildIdentity('0.1.1', () => '')).toThrow(/git commit/);
});

test('stampApp gives the main executable, each helper and the server their own UUID', () => {
  const root = mkdtempSync(join(tmpdir(), 'printtally-macho-')), app = join(root, 'Print Tally.app');
  try {
    const files = [
      'Contents/MacOS/Print Tally',
      'Contents/Frameworks/Print Tally Helper.app/Contents/MacOS/Print Tally Helper',
      'Contents/Frameworks/Print Tally Helper (GPU).app/Contents/MacOS/Print Tally Helper (GPU)',
      'Contents/Resources/server/printtally-server',
    ];
    for (const file of files) { mkdirSync(dirname(join(app, file)), { recursive: true }); writeFileSync(join(app, file), thin().bytes); }
    mkdirSync(join(app, 'Contents/Frameworks/Electron Framework.framework'));
    const stamped = stampApp(app, { version: '1.2.3', build: 'abc123' });
    expect(stamped.map(({ path }) => path).sort()).toEqual([...files].sort());
    const uuids = stamped.flatMap(({ after }) => after);
    expect(new Set(uuids).size).toBe(files.length);
    for (const { path, after } of stamped) expect(readUuids(readFileSync(join(app, path)))).toEqual(after);
    rmSync(join(app, files[3]!));
    expect(() => stampApp(app, { version: '1.2.3', build: 'abc123' })).toThrow(/Missing executables/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
