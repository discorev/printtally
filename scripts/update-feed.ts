import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';

export function mergeReleaseNotes(appBody: string, backendBody = ''): string {
  const sections = new Map<string, string[]>();
  for (const body of [appBody, backendBody]) {
    let section: string | undefined;
    for (const line of body.split(/\r?\n/)) {
      const heading = /^### (.+?)\s*$/.exec(line);
      if (heading) {
        section = heading[1] === 'Dependencies' ? undefined : heading[1];
        if (section && !sections.has(section)) sections.set(section, []);
        continue;
      }
      if (!section || !/^\* /.test(line)) continue;
      const bullet = line.replace(/\s+\(\[[^\]]+\]\(https:\/\/github\.com\/discorev\/printtally\/commit\/[a-f\d]+\)\)/gi, '').trim();
      const items = sections.get(section)!;
      if (!items.includes(bullet)) items.push(bullet);
    }
  }
  return [...sections].filter(([, items]) => items.length)
    .map(([heading, items]) => `### ${heading}\n\n${items.join('\n')}`).join('\n\n');
}

export async function makeUpdateFeed(version: string, zipPath: string, zipUrl: string, appBody: string, backendBody = '', releaseDate = new Date()): Promise<string> {
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(zipPath)) hash.update(chunk);
  const sha512 = hash.digest('base64');
  const size = (await stat(zipPath)).size;
  const notes = mergeReleaseNotes(appBody, backendBody);
  return [
    `version: ${JSON.stringify(version)}`,
    'files:',
    `  - url: ${JSON.stringify(zipUrl)}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    `path: ${JSON.stringify(zipUrl)}`,
    `sha512: ${sha512}`,
    `releaseDate: ${JSON.stringify(releaseDate.toISOString())}`,
    notes ? `releaseNotes: |-\n${notes.split('\n').map(line => `  ${line}`).join('\n')}` : 'releaseNotes: ""',
    '',
  ].join('\n');
}

if (import.meta.main) {
  const [version, zipPath, zipUrl, appNotesPath, backendNotesPath, output = 'latest-mac.yml'] = Bun.argv.slice(2);
  if (!version || !zipPath || !zipUrl || !appNotesPath) {
    console.error('Usage: bun scripts/update-feed.ts VERSION ZIP ZIP_URL APP_NOTES [BACKEND_NOTES] [OUTPUT]');
    process.exit(1);
  }
  const appBody = await readFile(appNotesPath, 'utf8');
  const backendBody = backendNotesPath ? await readFile(backendNotesPath, 'utf8') : '';
  await writeFile(output, await makeUpdateFeed(version, zipPath, zipUrl, appBody, backendBody));
}
