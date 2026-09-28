import { spawn } from 'node:child_process';
import { lookup } from 'node:dns/promises';
export interface BonjourAdvertisement { name: string; type: string; addresses?: string[]; txt?: Record<string, unknown> }
interface BrowseResult { name: string; type: string; domain: string }
// dns-sd delegates to mDNSResponder, avoiding a second multicast socket competing
// with macOS Bonjour. Never invoke a shell or interpret advertised text as code.
export function parseBonjourBrowse(output: string): BrowseResult[] {
  const found = new Map<string, BrowseResult>();
  for (const line of output.split('\n')) {
    const match = /^\S+\s+(Add|Rmv)\s+\S+\s+\d+\s+(\S+)\s+(_(?:ipp|ipps|printer)\._tcp\.?)\s+(.+)$/.exec(line);
    if (!match || match[2] !== 'local.' || match[4].length > 255) continue;
    const item = { name: match[4].trimEnd(), type: match[3].replace(/\.$/, ''), domain: 'local.' };
    const id = item.type + '\0' + item.name;
    if (match[1] === 'Rmv') found.delete(id); else if (found.size < 32) found.set(id, item);
  }
  return [...found.values()];
}
export function parseBonjourHost(output: string): string | undefined {
  const match = /can be reached at ([A-Za-z0-9_.-]+\.local\.?):\d+/.exec(output);
  return match?.[1];
}
async function dnsSd(args: string[], durationMs: number, stopWhen?: (output: string) => boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/dns-sd', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '', tooLarge = false;
    const stop = (): void => { child.kill('SIGTERM'); };
    const timer = setTimeout(stop, durationMs);
    child.stdout.on('data', (data: Buffer) => {
      output += data.toString('utf8');
      if (Buffer.byteLength(output) > 65536) { tooLarge = true; stop(); }
      else if (stopWhen?.(output)) stop();
    });
    child.once('error', () => { clearTimeout(timer); reject(new Error('Native Bonjour unavailable')); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (tooLarge || (code !== 0 && signal !== 'SIGTERM')) reject(new Error('Native Bonjour failed'));
      else resolve(output);
    });
  });
}
async function addresses(host: string): Promise<string[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      lookup(host, { family: 4, all: true }).then(rows => rows.map(row => row.address)),
      new Promise<string[]>(resolve => { timer = setTimeout(() => resolve([]), 2000); }),
    ]);
  } catch { return []; } finally { clearTimeout(timer); }
}
export async function browseMacPrinters(durationMs: number): Promise<BonjourAdvertisement[]> {
  const outputs = await Promise.all(['_ipp._tcp', '_ipps._tcp', '_printer._tcp'].map(type => dnsSd(['-B', type, 'local.'], durationMs)));
  const services = outputs.flatMap(parseBonjourBrowse).slice(0, 32);
  const results: BonjourAdvertisement[] = [];
  // Bound resolver processes. An unresolved advertisement is just omitted.
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, services.length) }, async () => {
    while (cursor < services.length) {
      const service = services[cursor++];
      try {
        const output = await dnsSd(['-L', service.name, service.type, service.domain], 2000, text => !!parseBonjourHost(text));
        const host = parseBonjourHost(output);
        if (host) results.push({ name: service.name, type: service.type.slice(1).split('.')[0], addresses: await addresses(host) });
      } catch { /* Other advertisements/manual entry may still work. */ }
    }
  }));
  return results;
}
