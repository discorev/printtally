import { createHash } from 'node:crypto';
import type { MigrationMeta } from 'drizzle-orm/migrator';
import journal from '../drizzle/meta/_journal.json' with { type: 'json' };
import initial from '../drizzle/0000_initial.sql' with { type: 'text' };
import ledger from '../drizzle/0001_ledger.sql' with { type: 'text' };
import printerInk from '../drizzle/0002_printer_ink.sql' with { type: 'text' };
import allocation from '../drizzle/0003_cartridge_allocation.sql' with { type: 'text' };
import indexedFittings from '../drizzle/0004_fitting_unit.sql' with { type: 'text' };

// Migrations are imported rather than read from disk so `bun build --compile` embeds them.
// Built exactly as drizzle's readMigrationFiles would from drizzle/; add each new migration here.
const files: Record<string, string> = { '0000_initial': initial, '0001_ledger': ledger, '0002_printer_ink': printerInk, '0003_cartridge_allocation': allocation, '0004_fitting_unit': indexedFittings };
export const migrations: MigrationMeta[] = journal.entries.map(entry => {
  const query = files[entry.tag];
  if (query === undefined) throw new Error('Migration ' + entry.tag + ' is not embedded');
  return { sql: query.split('--> statement-breakpoint'), bps: entry.breakpoints, folderMillis: entry.when, hash: createHash('sha256').update(query).digest('hex') };
});
