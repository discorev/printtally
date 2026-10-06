import { count, desc, eq } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { ArchivedPrinter, KnownPrinter } from 'print-accounting-contracts';
import type { AccountingDatabase } from './index.ts';
import { known_printers, print_jobs, printer_ink_readings, printers } from './schema.ts';
export interface StoredPrinter extends KnownPrinter { rootCertificatePem: string }
export class TrustConflictError extends Error {}
function record(row: typeof known_printers.$inferSelect): StoredPrinter {
  return { id: row.id, host: row.host, name: row.name, mac: row.mac,
    fingerprintSha256: row.root_fingerprint_sha256, rootCertificatePem: row.root_certificate_pem,
    validFrom: row.root_valid_from, validTo: row.root_valid_to,
    confirmedAt: row.confirmed_at, lastVerifiedAt: row.last_verified_at };
}
export class KnownPrinters {
  private db: AccountingDatabase;
  constructor(db: AccountingDatabase) { this.db = db; }
  private find(column: SQLiteColumn, value: string): StoredPrinter | undefined {
    const row = this.db.orm.select().from(known_printers).where(eq(column, value)).get();
    return row && record(row);
  }
  list(): StoredPrinter[] { return this.db.orm.select().from(known_printers).orderBy(known_printers.name, known_printers.id).all().map(record); }
  get(id: string): StoredPrinter | undefined { return this.find(known_printers.id, id); }
  atHost(host: string): StoredPrinter | undefined { return this.find(known_printers.host, host); }
  withRoot(fingerprint: string): StoredPrinter | undefined { return this.find(known_printers.root_fingerprint_sha256, fingerprint); }
  rename(id: string, name: string): StoredPrinter | undefined {
    this.db.orm.update(known_printers).set({ name }).where(eq(known_printers.id, id)).run();
    return this.get(id);
  }
  /** Every printer the archive holds, with its job count, named as the known printer with its MAC.
   *  Both tables hold MACs as 12 lower-case hex digits (their CHECK constraints), so they compare as they are. */
  archived(): ArchivedPrinter[] {
    // The last confirmation for a MAC wins, even if an older enrolment sorts later by name.
    const known = new Map(this.db.orm.select().from(known_printers).orderBy(known_printers.confirmed_at, known_printers.id).all()
      .map(row => [row.mac, record(row)]));
    const jobs = this.db.orm.select({ printer: print_jobs.printer_id, jobs: count() }).from(print_jobs).groupBy(print_jobs.printer_id).all();
    const inks = this.db.orm.select().from(printer_ink_readings)
      .orderBy(desc(printer_ink_readings.first_seen_at), desc(printer_ink_readings.id)).all();
    const firstSeen = new Map<string, string>();
    for (const ink of inks) firstSeen.set(`${ink.printer_id}:${ink.channel}`, ink.first_seen_at);
    return this.db.orm.select().from(printers).all().map(row => {
      const latest = new Map<string, typeof inks[number]>();
      for (const ink of inks) if (ink.printer_id === row.id && !latest.has(ink.channel)) latest.set(ink.channel, ink);
      const match = known.get(row.mac);
      return { id: row.id, name: match?.name ?? row.display_name ?? row.mac.match(/../g)!.join(':'), host: match?.host ?? row.last_host,
        known_printer_id: match?.id ?? null, jobs: jobs.find(item => item.printer === row.id)?.jobs ?? 0,
        model: row.model, firmware: row.firmware, inks: [...latest.values()].map(ink => ({
          channel: ink.channel, series: ink.series, level: ink.level, replacement_count: ink.replacement_count, observed_at: ink.last_seen_at,
          first_observed_at: firstSeen.get(`${row.id}:${ink.channel}`),
        })).sort((a, b) => a.channel.localeCompare(b.channel)) };
    }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || a.id - b.id);
  }
  save(printer: StoredPrinter, expected: StoredPrinter | undefined): void {
    this.db.transaction(() => {
      const current = this.get(printer.id);
      if (JSON.stringify(current) !== JSON.stringify(expected)) throw new TrustConflictError('Printer changed since preview');
      for (const other of [this.atHost(printer.host), this.withRoot(printer.fingerprintSha256)]) {
        if (other && other.id !== printer.id) throw new TrustConflictError('Printer address or root is already registered');
      }
      const fields = { host: printer.host, name: printer.name, mac: printer.mac, root_certificate_pem: printer.rootCertificatePem,
        root_fingerprint_sha256: printer.fingerprintSha256, root_valid_from: printer.validFrom, root_valid_to: printer.validTo,
        confirmed_at: printer.confirmedAt, last_verified_at: printer.lastVerifiedAt };
      this.db.orm.insert(known_printers).values({ id: printer.id, ...fields }).onConflictDoUpdate({ target: known_printers.id, set: fields }).run();
    });
  }
}
