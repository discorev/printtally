// A throwaway data folder with a ledger for UI work, seeded with realistic sample data:
//   bun run seed:dev [snapshot.json]   (default tests/fixtures/reference.json; e.g. a copy of jobs.json)
// The printers sit at TEST-NET addresses (192.0.2.10 and .11), so collection fails fast and never reaches a
// real printer, and no password or Keychain item is created. The second printer has a few of the same jobs
// again, so the Jobs printer filter shows.
import { mkdtempSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { X509Certificate } from 'node:crypto';
import { AccountingDatabase, KnownPrinters, Ledger } from 'print-accounting-database';
import { snapshotSchema } from 'print-accounting-contracts';
import { tlsFixtures } from '../tests/tls-fixtures.ts';

const source = resolve(process.argv[2] ?? new URL('../tests/fixtures/reference.json', import.meta.url).pathname);
const input: { snapshot?: unknown } = JSON.parse(readFileSync(source, 'utf8'));
const snapshot = snapshotSchema.parse(input.snapshot ?? input);
const dir = mkdtempSync(join(tmpdir(), 'printtally-dev-')), db = new AccountingDatabase(join(dir, 'accounting.sqlite3'));
const ledger = new Ledger(db), money = (pounds: number) => Math.round(pounds * 1_000_000), mm = (value: number) => Math.round(value * 1000);
// A printer's day stamp (YYYYMMDDhhmmss) moved on by some days.
const later = (stamp: unknown, days: number) => {
  if (typeof stamp !== 'string' || !/^\d{14}$/.test(stamp)) return stamp;
  const day = new Date(Date.UTC(Number(stamp.slice(0, 4)), Number(stamp.slice(4, 6)) - 1, Number(stamp.slice(6, 8)) + days));
  return day.toISOString().slice(0, 10).replaceAll('-', '') + stamp.slice(8);
};
const OFFICE_MAC = snapshot.printer.mac === '0200000000ff' ? '0200000000fe' : '0200000000ff';
const office = structuredClone(snapshot), recent = snapshot.records.slice(-3);
office.printer = { host: '192.0.2.11', mac: OFFICE_MAC };
if (office.media_catalogue) office.media_catalogue.printer_mac = OFFICE_MAC;
// An empty history gets an Office printer with no jobs.
office.records = (recent.length ? [0, 1, 2] : []).map(index => {
  const record = structuredClone(recent[index % recent.length]);
  Object.assign(record.raw, { job_record_number: index + 1, job_time_at_processing: later(record.raw.job_time_at_processing, index + 1),
    job_time_at_completed: later(record.raw.job_time_at_completed, index + 1) });
  return record;
});
office.requested_range = office.records.length ? [1, office.records.length] : snapshot.requested_range;
try {
  const imported = db.importSnapshot(snapshot), second = db.importSnapshot(office);
  const roots = await tlsFixtures(), known = new KnownPrinters(db), now = new Date().toISOString();
  const printer = (id: string, host: string, name: string, mac: string, pem: string) => {
    const root = new X509Certificate(pem);
    known.save({ id, host, name, mac, fingerprintSha256: root.fingerprint256, rootCertificatePem: root.toString(),
      validFrom: root.validFromDate.toISOString(), validTo: root.validToDate.toISOString(), confirmedAt: now, lastVerifiedAt: now }, undefined);
  };
  printer('00000000-0000-4000-8000-00000000d0c7', '192.0.2.10', 'PRO-1100 (dev seed)', snapshot.printer.mac, roots.root);
  printer('00000000-0000-4000-8000-00000000d0c8', '192.0.2.11', 'Office PRO-1100 (dev seed)', OFFICE_MAC, roots.otherRoot);

  // Papers list the printer media types they print as, matched by the media's English name.
  const media = Object.entries(snapshot.media_catalogue?.entries ?? {}).map(([id, entry]) => ({ id, name: entry.names.EN }));
  const papers: [string, string, string[]][] = [
    ['pe310', 'Fotospeed Platinum Etching 310', ['Fotospeed Platinum Etching 310', 'FS Platinum Etching 310 (Matte)']],
    ['pearl', 'Hahnemühle FineArt Pearl', ['Hahnemuehle FineArt Pearl']],
    ['museum', 'Hahnemühle Museum Etching', ['Museum Etching']],
    ['luster', 'Canon Photo Paper Pro Luster', ['Photo Paper Pro Luster']],
    ['prb', 'Hahnemühle Photo Rag Baryta', ['Hahnemuehle FA PhotoRag Baryta']],
    ['pb300', 'Fotospeed Platinum Baryta 300', ['Fotospeed Platinum Baryta 300']],
    ['prbw', 'Hahnemühle Photo Rag Bright White', ['Hahnemuehle PR Bright White']],
    ['platinum', 'Canon Photo Paper Pro Platinum', ['Photo Paper Pro Platinum']],
  ];
  const mediaFor = papers.map(([, , names]) => media.filter(item => item.name !== undefined && names.includes(item.name)).map(item => item.id));
  // The synthetic reference snapshot uses none of these names: give its media to the first paper.
  if (mediaFor.every(list => !list.length)) mediaFor[0] = [...new Set(snapshot.records.map(record => record.raw.job_media_type_name).filter(name => typeof name === 'string'))];
  const paper = Object.fromEntries(papers.map(([key, name], index) => [key, ledger.createPaper({ name, media_types: mediaFor[index] })]));

  const sheet = (key: string, name: string, width: number, height: number, deckle = false) => ledger.createStock({ paper_id: paper[key], name, format: 'sheet', width_um: mm(width), height_um: mm(height), deckle });
  const A4 = [210, 297] as const, A3P = [329, 483] as const;
  const stock = {
    'pe310-a4': sheet('pe310', 'A4', ...A4), 'pe310-a3p': sheet('pe310', 'A3+', ...A3P),
    'pearl-a4': sheet('pearl', 'A4', ...A4), 'pearl-17': ledger.createStock({ paper_id: paper.pearl, name: '17" roll', format: 'roll', width_um: mm(431.8) }),
    'pearl-1725': sheet('pearl', '17×25 in', 431.8, 635),
    'museum-a4': sheet('museum', 'A4', ...A4), 'museum-a3p-d': sheet('museum', 'A3+ deckle', ...A3P, true),
    'luster-a4': sheet('luster', 'A4', ...A4), 'prb-a4': sheet('prb', 'A4', ...A4),
    'pb300-a4': sheet('pb300', 'A4', ...A4), 'pb300-12': sheet('pb300', '12×12 in', 304.8, 304.8),
    'prbw-a4': sheet('prbw', 'A4', ...A4), 'platinum-a4': sheet('platinum', 'A4', ...A4),
  };
  const packs = (item: keyof typeof stock, date: string, count: number, perPack: number, price: number) =>
    ledger.createPaperPurchase({ paper_stock_id: stock[item], purchased_on: date, packs: count, sheets_per_pack: perPack, price_micros: money(price) });
  packs('pe310-a4', '2026-01-10', 1, 25, 34.99); packs('pe310-a4', '2026-06-02', 1, 25, 37.99); packs('pe310-a3p', '2026-03-14', 1, 25, 84.99);
  packs('pearl-a4', '2025-10-20', 1, 25, 41.95); packs('pearl-a4', '2026-03-01', 1, 25, 44.95);
  ledger.createPaperPurchase({ paper_stock_id: stock['pearl-17'], purchased_on: '2026-02-10', length_um: 12_000_000, price_micros: money(92) });
  packs('pearl-1725', '2026-05-15', 1, 25, 148); packs('museum-a4', '2025-11-28', 1, 25, 47.95); packs('museum-a3p-d', '2026-02-16', 1, 25, 132);
  packs('luster-a4', '2025-11-01', 1, 50, 27.99); packs('luster-a4', '2026-05-10', 1, 50, 29.49); packs('prb-a4', '2026-01-20', 1, 25, 39.95);
  packs('pb300-a4', '2026-04-01', 1, 25, 33.99); packs('pb300-12', '2026-05-20', 1, 25, 41.5); packs('prbw-a4', '2026-02-01', 1, 25, 36.95);
  packs('platinum-a4', '2025-12-10', 1, 20, 24.99);

  const channels = ['PM', 'R', 'C', 'PGY', 'MBK', 'PBK', 'B', 'CO', 'GY', 'Y', 'M', 'PC'];
  const cartridge = Object.fromEntries(channels.map(channel => [channel, ledger.createCartridge({ name: 'PFI-4100 ' + channel, channel, capacity_nl: 80_000_000 })]));
  const ink = (channel: string, date: string, price: number) => ledger.createInkPurchase({ ink_product_id: cartridge[channel], purchased_on: date, cartridges: 1, price_micros: money(price) });
  for (const channel of channels) ink(channel, '2025-10-15', 38.9);
  ink('MBK', '2026-05-05', 42.5); ink('PBK', '2026-05-05', 42.5); ink('M', '2026-08-12', 42.5); ink('CO', '2026-08-20', 41); ink('GY', '2026-09-02', 43);

  ledger.createWriteOff({ paper_stock_id: stock['museum-a4'], written_off_on: '2026-04-30', quantity: 4, reason: 'Damp — the bottom of the pack' });
  ledger.createWriteOff({ paper_stock_id: stock['pe310-a4'], written_off_on: '2026-07-14', quantity: 2, reason: 'Creased corners — the box was damaged in the post' });
  ledger.createWriteOff({ ink_product_id: cartridge.M, written_off_on: '2026-08-12', all_remaining: true, reason: 'Printer reported it as faulty' });

  console.log(`Seeded ${dir}\n  ${imported.new_jobs} jobs from ${source}, and ${second.new_jobs} on a second printer; ${papers.length} papers, ${Object.keys(stock).length} stock items, ${channels.length} cartridges, 3 write-offs; printers at 192.0.2.10 and 192.0.2.11 (TEST-NET)`);
  console.log(`\nRun the server against it (pick a free port; never 4318, which may be your real server):\n  PRINTTALLY_MEMORY_SECRETS=1 bun apps/server/src/cli.ts serve --port 4400 --data-dir ${dir}`);
  console.log(`Then the UI with hot reload:\n  PRINTTALLY_API=http://127.0.0.1:4400 bun run dev:web`);
} finally { db.close(); }
