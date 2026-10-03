import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeUpdateFeed, mergeReleaseNotes } from './update-feed.ts';

const app = `## [0.3.0](https://github.com/discorev/printtally/compare/app-v0.2.2...app-v0.3.0) (2026-10-03)

### Features

* **desktop:** updates in the app ([3573c6a](https://github.com/discorev/printtally/commit/3573c6a))

### Dependencies

* The following workspace dependencies were updated
  * peerDependencies
    * printtally-workspace bumped to 0.3.0`;
const backend = `## [0.4.0](https://github.com/discorev/printtally/compare/backend-v0.3.0...backend-v0.4.0) (2026-10-03)

### Features

* **desktop:** updates in the app ([abcdef1](https://github.com/discorev/printtally/commit/abcdef1))
* **web:** paper names ([abcd123](https://github.com/discorev/printtally/commit/abcd123))

### Bug Fixes

* **core:** ink totals ([123abcd](https://github.com/discorev/printtally/commit/123abcd))`;

test('notes merge sections, drop release headings and dependencies, strip commit links, and dedupe bullets', () => {
  expect(mergeReleaseNotes(app, backend)).toBe(`### Features\n\n* **desktop:** updates in the app\n* **web:** paper names\n\n### Bug Fixes\n\n* **core:** ink totals`);
  expect(mergeReleaseNotes(app)).toBe('### Features\n\n* **desktop:** updates in the app');
  expect(mergeReleaseNotes('### Dependencies\n\n* workspace bump')).toBe('');
});

test('feed hashes the zip and includes its absolute URL, date, and offered release notes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'printtally-feed-'));
  try {
    const zip = join(dir, 'PrintTally-0.3.0.zip');
    const bytes = Buffer.from('a local update zip');
    writeFileSync(zip, bytes);
    const url = 'http://127.0.0.1:4400/PrintTally-0.3.0.zip';
    const feed = await makeUpdateFeed('0.3.0', zip, url, app, backend, new Date('2026-10-03T10:00:00.000Z'));
    const sha512 = createHash('sha512').update(bytes).digest('base64');
    expect(feed).toContain('version: "0.3.0"');
    expect(feed).toContain(`  - url: "${url}"\n    sha512: ${sha512}\n    size: ${bytes.length}`);
    expect(feed).toContain(`path: "${url}"\nsha512: ${sha512}`);
    expect(feed).toContain('releaseDate: "2026-10-03T10:00:00.000Z"');
    expect(feed).toContain('releaseNotes: |-\n  ### Features\n  \n  * **desktop:** updates in the app');
    const parsed = Bun.YAML.parse(feed) as { version: string; path: string; files: Array<{ url: string; sha512: string; size: number }>; releaseNotes: string };
    expect(parsed.version).toBe('0.3.0');
    expect(parsed.path).toBe(url);
    expect(parsed.files).toEqual([{ url, sha512, size: bytes.length }]);
    expect(parsed.releaseNotes).toBe(mergeReleaseNotes(app, backend));
  } finally { rmSync(dir, { recursive: true }); }
});
