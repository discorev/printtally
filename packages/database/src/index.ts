import { Database } from 'bun:sqlite';
import { constants, mkdirSync, openSync, fstatSync, fchmodSync, closeSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { snapshotSchema, annotationSchema, jobDetailsSchema, type JobDetails, type Snapshot, type Catalogue, type Names, type ImportResult } from 'print-accounting-contracts';
import { digest, encoded, now, timestamp, scaled } from 'print-accounting-core';
import { printers, import_runs, media_configs, media_revisions, print_jobs, job_observations, job_ink_usage, import_job_observations, job_annotations, paper_prices, ink_prices, job_details } from './schema.ts';

export const APPLICATION_ID = 1128353872; // 'CAPP'
export type Row = Record<string, string | number | null>;
type Value = string | number | null;
// Integers are stored and returned as JavaScript numbers, so refuse any value
// that cannot be represented exactly rather than silently rounding it.
export function safeInteger(value: number | bigint | string): number {
  if (typeof value === 'string' && !/^-?\d+$/.test(value)) throw new Error('Invalid integer');
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error('Integer is outside the safe range (±9007199254740991) and cannot be stored exactly');
  return result;
}
const whole = (value: number | bigint | string | null | undefined): number | null => value == null ? null : safeInteger(value);
const text = (value: number | string | null | undefined): string | null => value == null ? null : String(value);
const bind = (values: Value[]): Value[] => values.map(value => typeof value === 'number' ? safeInteger(value) : value);
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
export class AccountingDatabase {
  private sqlite: Database;
  readonly orm: BunSQLiteDatabase;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const fd = openSync(path, constants.O_RDWR | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      const info = fstatSync(fd);
      if (!info.isFile() || (process.getuid && info.uid !== process.getuid())) throw new Error('Database must be an owned regular file');
      fchmodSync(fd, 0o600);
    } finally { closeSync(fd); }
    this.sqlite = new Database(path, { strict: true });
    this.orm = drizzle({ client: this.sqlite });
    try {
      this.sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
      const appId = Number(this.get('PRAGMA application_id')!.application_id);
      const has = (name: string | null) => !!this.get("SELECT 1 FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND (?1 IS NULL OR name=?1)", name);
      // A fresh file is migrated then marked; a marked file must have Drizzle's history.
      if (appId === APPLICATION_ID ? !has('__drizzle_migrations') : appId !== 0 || has(null)) {
        throw new Error(appId === APPLICATION_ID ? 'Database was created by an unsupported earlier version' : 'Not a Print Tally database');
      }
      // The initial migration sets application_id inside its own transaction.
      migrate(this.orm, { migrationsFolder });
    } catch (error) { this.sqlite.close(); throw error; }
  }
  close(): void { this.sqlite.close(); }
  exec(sql: string): void { this.sqlite.exec(sql); }
  run(sql: string, ...values: Value[]): number {
    return safeInteger(this.sqlite.query<Row, Value[]>(sql).run(...bind(values)).lastInsertRowid);
  }
  all(sql: string, ...values: Value[]): Row[] { return this.sqlite.query<Row, Value[]>(sql).all(...bind(values)); }
  get(sql: string, ...values: Value[]): Row | undefined { return this.all(sql, ...values)[0]; }
  transaction<T>(action: () => T): T { return this.orm.transaction(() => action(), { behavior: 'immediate' }); }
  startImport(source: 'live' | 'snapshot', host: string | null = null): number {
    return this.orm.insert(import_runs).values({ source, source_host: host, started_at: now(), status: 'running' }).returning({ id: import_runs.id }).get().id;
  }
  failImport(runId: number, category: string): void {
    if (!['collection_failed', 'invalid_snapshot', 'database_failed'].includes(category)) category = 'collection_failed';
    this.orm.update(import_runs).set({ status: 'failed', finished_at: now(), error_code: category })
      .where(and(eq(import_runs.id, runId), eq(import_runs.status, 'running'))).run();
  }
  private ensureMedia(printerId: number, sourceId: string | null, observedAt: string): number | null {
    if (!sourceId) return null;
    return this.orm.insert(media_configs).values({ printer_id: printerId, source_media_id: sourceId, first_seen_at: observedAt, last_seen_at: observedAt })
      .onConflictDoUpdate({ target: [media_configs.printer_id, media_configs.source_media_id], set: {
        first_seen_at: sql`min(${media_configs.first_seen_at},excluded.first_seen_at)`, last_seen_at: sql`max(${media_configs.last_seen_at},excluded.last_seen_at)` } })
      .returning({ id: media_configs.id }).get().id;
  }
  private addMediaRevision(mediaId: number, entry: Names, observedAt: string): number {
    const content = { names: entry.names, short_name: entry.short_name ?? null, checksum: entry.checksum ?? null };
    return this.orm.insert(media_revisions).values({ media_id: mediaId, content_hash: digest(content), names_json: encoded(content.names),
      short_name: content.short_name, english_name: content.names.EN ?? null, checksum: content.checksum, first_observed_at: observedAt, last_observed_at: observedAt })
      .onConflictDoUpdate({ target: [media_revisions.media_id, media_revisions.content_hash], set: {
        first_observed_at: sql`min(${media_revisions.first_observed_at},excluded.first_observed_at)`, last_observed_at: sql`max(${media_revisions.last_observed_at},excluded.last_observed_at)` } })
      .returning({ id: media_revisions.id }).get().id;
  }
  private importMedia(printerId: number, catalogue: Catalogue | undefined, fallback: string): void {
    if (!catalogue) return;
    const observedAt = timestamp(catalogue.collected_at || fallback);
    const previous = this.orm.select({ at: printers.media_observed_at }).from(printers).where(eq(printers.id, printerId)).get()!.at;
    const isCurrent = previous === null || observedAt >= previous;
    if (isCurrent) this.orm.update(media_configs).set({ present_on_printer: 0 }).where(eq(media_configs.printer_id, printerId)).run();
    for (const [sourceId, entry] of Object.entries(catalogue.entries)) {
      const seen = timestamp(entry.observed_at || observedAt);
      const mediaId = this.ensureMedia(printerId, sourceId, seen)!;
      for (const old of entry.name_history ?? []) this.addMediaRevision(mediaId, old, timestamp(old.observed_at || seen));
      const revision = this.addMediaRevision(mediaId, entry, seen);
      const current = this.orm.select({ id: media_configs.current_revision_id }).from(media_configs).where(eq(media_configs.id, mediaId)).get()!.id;
      if (isCurrent || current === null) this.orm.update(media_configs).set({ current_revision_id: revision, present_on_printer: Number(entry.present_on_printer), visible: Number(entry.visible ?? false) })
        .where(eq(media_configs.id, mediaId)).run();
    }
    if (isCurrent) this.orm.update(printers).set({ media_observed_at: observedAt }).where(eq(printers.id, printerId)).run();
  }
  persistSnapshot(runId: number, input: unknown): ImportResult {
    const snapshot = snapshotSchema.parse(input);
    const observedAt = timestamp(snapshot.collected_at), mac = snapshot.printer.mac;
    if (snapshot.media_catalogue && snapshot.media_catalogue.printer_mac !== mac) throw new Error('Media catalogue belongs to another printer');
    const schema = snapshot.schema, fields = new Map(schema.map(field => [field.name, field]));
    if (fields.size !== schema.length) throw new Error('Duplicate schema fields');
    const [first, last] = snapshot.requested_range;
    if (last < first) throw new Error('Invalid requested range');
    return this.transaction(() => {
      if (this.orm.select({ status: import_runs.status }).from(import_runs).where(eq(import_runs.id, runId)).get()?.status !== 'running') throw new Error('Import is not running');
      const printerId = this.orm.insert(printers).values({ mac, last_host: snapshot.printer.host, first_seen_at: observedAt, last_seen_at: observedAt })
        .onConflictDoUpdate({ target: printers.mac, set: {
          last_host: sql`CASE WHEN excluded.last_seen_at>=${printers.last_seen_at} THEN excluded.last_host ELSE ${printers.last_host} END`,
          first_seen_at: sql`min(${printers.first_seen_at},excluded.first_seen_at)`, last_seen_at: sql`max(${printers.last_seen_at},excluded.last_seen_at)` } })
        .returning({ id: printers.id }).get().id;
      this.importMedia(printerId, snapshot.media_catalogue, observedAt);
      let newJobs = 0, newObservations = 0, collisions = 0;
      const seen = new Set<number>();
      for (const record of snapshot.records) {
        const raw = record.raw, id = raw.job_record_number;
        if (typeof id !== 'number' || id < first || id > last || seen.has(id)) throw new Error('Unexpected or duplicate record ID');
        // Reject malformed snapshot values before they can alter persisted identity/units.
        for (const field of schema) {
          const amount = raw[field.name];
          if (!(field.name in raw) || (amount !== null && (field.type === 'uint' ? typeof amount !== 'number' : typeof amount !== 'string'))) throw new Error('Record does not match schema');
        }
        seen.add(id);
        const identity = Object.fromEntries(['job_record_number', 'job_time_at_processing', 'job_name', 'job_owner'].map(name => [name, raw[name] ?? null]));
        const identityHash = digest(identity);
        const job = this.orm.select({ id: print_jobs.id, current: print_jobs.current_observation_id }).from(print_jobs)
          .where(and(eq(print_jobs.printer_id, printerId), eq(print_jobs.source_record_id, id), eq(print_jobs.identity_hash, identityHash))).get();
        let jobId: number;
        const currentObservation = job?.current ?? null;
        if (!job) {
          if (this.orm.select({ id: print_jobs.id }).from(print_jobs).where(and(eq(print_jobs.printer_id, printerId), eq(print_jobs.source_record_id, id))).get()) collisions++;
          jobId = this.orm.insert(print_jobs).values({ printer_id: printerId, source_record_id: id, identity_hash: identityHash, identity_json: encoded(identity), first_seen_at: observedAt, last_seen_at: observedAt })
            .returning({ id: print_jobs.id }).get().id;
          newJobs++;
        } else {
          jobId = job.id;
          this.orm.update(print_jobs).set({ first_seen_at: sql`min(${print_jobs.first_seen_at},${observedAt})`, last_seen_at: sql`max(${print_jobs.last_seen_at},${observedAt})` })
            .where(eq(print_jobs.id, jobId)).run();
        }
        const contentHash = digest({ raw, schema });
        const existing = this.orm.select({ id: job_observations.id }).from(job_observations)
          .where(and(eq(job_observations.job_id, jobId), eq(job_observations.content_hash, contentHash))).get();
        let observationId: number;
        if (!existing) {
          const mediaId = this.ensureMedia(printerId, typeof raw.job_media_type_name === 'string' ? raw.job_media_type_name : null, observedAt);
          observationId = this.orm.insert(job_observations).values({
            job_id: jobId, content_hash: contentHash, first_import_id: runId, first_observed_at: observedAt, last_observed_at: observedAt, raw_json: encoded(raw),
            media_config_id: mediaId, resolved_media_name: record.media?.name ?? null, job_name: text(raw.job_name), job_owner: text(raw.job_owner),
            started_at_raw: text(raw.job_time_at_processing), completed_at_raw: text(raw.job_time_at_completed),
            completion_state: text(raw.job_complete_state), job_type: text(raw.job_type),
            width_um: whole(scaled(raw, fields, 'job_data_size_width', 'mm', 1000n)), height_um: whole(scaled(raw, fields, 'job_data_size_height', 'mm', 1000n)),
            used_area_mm2: whole(scaled(raw, fields, 'job_used_area', 'm2', 1000000n)),
            impressions: whole(raw.job_impressions_completed), color_pages: whole(raw.job_color_page_count), monochrome_pages: whole(raw.job_monochrome_page_count),
            duplex: text(raw.job_duplex),
          }).returning({ id: job_observations.id }).get().id;
          for (const name of fields.keys()) if (name.startsWith('job_used_ink_')) {
            this.orm.insert(job_ink_usage).values({ observation_id: observationId, channel: name.slice('job_used_ink_'.length), volume_nl: whole(scaled(raw, fields, name, 'ml', 1000000n)) }).run();
          }
          newObservations++;
        } else {
          observationId = existing.id;
          this.orm.update(job_observations).set({ first_observed_at: sql`min(${job_observations.first_observed_at},${observedAt})`, last_observed_at: sql`max(${job_observations.last_observed_at},${observedAt})` })
            .where(eq(job_observations.id, observationId)).run();
        }
        const currentTime = currentObservation === null ? null
          : this.orm.select({ at: job_observations.last_observed_at }).from(job_observations).where(eq(job_observations.id, currentObservation)).get()!.at;
        if (currentTime === null || observedAt >= currentTime) this.orm.update(print_jobs).set({ current_observation_id: observationId }).where(eq(print_jobs.id, jobId)).run();
        this.orm.insert(import_job_observations).values({ import_id: runId, job_id: jobId, observation_id: observationId }).run();
      }
      this.orm.update(import_runs).set({ source_host: snapshot.printer.host, printer_id: printerId, status: 'succeeded', finished_at: now(), observed_at: observedAt,
        requested_first: first, requested_last: last, received_count: seen.size, new_jobs: newJobs, new_observations: newObservations,
        record_id_collisions: collisions, schema_json: encoded(schema) }).where(eq(import_runs.id, runId)).run();
      return { import_id: runId, new_jobs: newJobs, new_observations: newObservations, record_id_collisions: collisions, received: seen.size };
    });
  }
  importSnapshot(input: unknown): ImportResult {
    const runId = this.startImport('snapshot');
    try { return this.persistSnapshot(runId, input); }
    catch (error) { this.failImport(runId, 'invalid_snapshot'); throw error; }
  }
  annotateJob(jobId: number, input: unknown): void {
    const { paper_cost_override_micros: micros, ...changes } = annotationSchema.parse(input);
    const cost = micros === undefined ? {} : { paper_cost_override_micros: whole(micros) };
    this.transaction(() => {
      if (!this.orm.select({ id: print_jobs.id }).from(print_jobs).where(eq(print_jobs.id, jobId)).get()) throw new Error('Unknown internal job ID');
      this.orm.insert(job_annotations).values({ job_id: jobId, updated_at: now() }).onConflictDoNothing().run();
      this.orm.update(job_annotations).set({ ...changes, ...cost, updated_at: now() }).where(eq(job_annotations.job_id, jobId)).run();
    });
  }
  attachAnnotations(runId: number, snapshot: Snapshot): void {
    const imported = this.orm.select({ id: import_job_observations.job_id }).from(import_job_observations).where(eq(import_job_observations.import_id, runId));
    const rows = this.orm.select().from(job_details).where(inArray(job_details.job_id, imported)).all();
    const byRecord = new Map(rows.map(row => [row.source_record_id, row]));
    for (const record of snapshot.records) {
      const row = byRecord.get(Number(record.raw.job_record_number))!;
      record.accounting = Object.fromEntries((['job_id', 'display_paper_name', 'hidden', 'custom_paper_name', 'stock_override_id', 'notes', 'physical_sheet_count', 'paper_cost_override_micros', 'paper_cost_currency', 'record_id_collision'] as const).map(key => [key, row[key]]));
      if (row.custom_paper_name === null && row.stock_override_id === null && record.media?.name != null) record.accounting.display_paper_name = record.media.name;
    }
  }
  summary(): Record<string, number> {
    const tables: Record<string, SQLiteTable> = { printers, print_jobs, job_observations, job_ink_usage, media_configs, media_revisions, import_runs, job_annotations, paper_prices, ink_prices };
    return Object.fromEntries(Object.entries(tables).map(([name, table]) => [name, this.orm.select({ count: count() }).from(table).get()!.count]));
  }
  jobs(limit = 100, offset = 0, includeHidden = false): JobDetails[] {
    return this.orm.select().from(job_details).where(includeHidden ? undefined : eq(job_details.hidden, 0))
      .orderBy(desc(job_details.job_id)).limit(limit).offset(offset).all().map(row => jobDetailsSchema.parse(row));
  }
}

export { KnownPrinters, TrustConflictError, type StoredPrinter } from './known-printers.ts';
