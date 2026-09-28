import { isIPv4 } from 'node:net';
import { browseMacPrinters, type BonjourAdvertisement } from './bonjour-macos.ts';
import type { DiscoveredPrinter } from 'print-accounting-contracts';
// Limit the local onboarding API to private/link-local printer addresses. Manual
// entry supports routed private networks; no hostname resolution or URL input.
export function isPrinterAddress(host: string): boolean {
  if (!isIPv4(host)) return false;
  const [a, b] = host.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 169 && b === 254 && host !== '169.254.169.254');
}
export function discoveredPrinters(advertisements: BonjourAdvertisement[]): DiscoveredPrinter[] {
  const found = new Map<string, DiscoveredPrinter>();
  for (const service of advertisements) {
    if (!['ipp', 'ipps', 'printer'].includes(service.type)) continue;
    const model = typeof service.txt?.ty === 'string' ? service.txt.ty.slice(0, 200) : null;
    for (const host of service.addresses ?? []) {
      if (!isPrinterAddress(host)) continue;
      const existing = found.get(host);
      if (existing) { if (!existing.services.includes(service.type)) existing.services.push(service.type); }
      else if (found.size < 256) found.set(host, { host, name: service.name.slice(0, 120), model, services: [service.type] });
    }
  }
  return [...found.values()].map(item => ({ ...item, services: item.services.sort() })).sort((a, b) => a.host.localeCompare(b.host));
}
export async function discoverPrinters(durationMs = 4000): Promise<DiscoveredPrinter[]> {
  if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > 10000) throw new Error('Invalid discovery duration');
  if (process.platform === 'darwin') return discoveredPrinters(await browseMacPrinters(durationMs));
  const { Bonjour } = await import('bonjour-service');
  return new Promise((resolve, reject) => {
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let instance: InstanceType<typeof Bonjour> | undefined;
    const browsers: ReturnType<InstanceType<typeof Bonjour>['find']>[] = [];
    const finish = (failed = false): void => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      const result = discoveredPrinters(browsers.flatMap(browser => browser.services));
      for (const browser of browsers) browser.stop();
      instance?.destroy();
      if (failed) reject(new Error('Printer discovery failed')); else resolve(result);
    };
    instance = new Bonjour({}, () => finish(true));
    if (finished) { instance.destroy(); return; }
    try {
      for (const type of ['ipp', 'ipps', 'printer']) browsers.push(instance.find({ type, protocol: 'tcp' }));
      timer = setTimeout(() => finish(), durationMs);
    } catch { finish(true); }
  });
}
