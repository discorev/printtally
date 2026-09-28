import { eq } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { KnownPrinter } from 'print-accounting-contracts';
import type { AccountingDatabase } from './index.ts';
import { known_printers } from './schema.ts';
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
