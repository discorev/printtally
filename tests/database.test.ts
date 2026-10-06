import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { AccountingDatabase, APPLICATION_ID } from 'print-accounting-database';
import { sample, MEDIA, T1 } from './fixtures.ts';
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'printtally-db-')), path = join(dir, 'test.sqlite3');
  const db = new AccountingDatabase(path);
  t.after(() => { db.close(); rmSync(dir, { recursive: true }); });
  return { db, path, dir };
}
test('repeat imports are idempotent and preserve ink precision', t => {
  const { db, path } = fixture(t); db.importSnapshot(sample());
  const result = db.importSnapshot(sample());
  assert.equal(result.new_jobs, 0); assert.equal(result.new_observations, 0);
  assert.equal(db.summary().import_runs, 2);
  assert.deepEqual(db.all('SELECT channel,volume_nl FROM job_ink_usage'), [{ channel: 'C', volume_nl: 125000 }, { channel: 'CO', volume_nl: null }]);
  assert.equal(db.jobs()[0].width_um, 210000); assert.equal(db.jobs()[0].used_area_mm2, 62300);
  assert.deepEqual(db.all('PRAGMA foreign_key_check'), []); assert.equal(statSync(path).mode & 0o777, 0o600);
});
test('job-only names and visibility survive reimports without renaming media', t => {
  const { db } = fixture(t), input = sample();
  const second = structuredClone(input.records[0]); second.raw.job_record_number = 2;
  input.records.push(second); input.requested_range = [1, 2]; db.importSnapshot(input);
  db.annotateJob(1, { custom_paper_name: 'One-off sample', hidden: 1, notes: 'Keep' });
  const result = db.importSnapshot(input); db.attachAnnotations(result.import_id, input);
  assert.equal(input.records[0].accounting?.display_paper_name, 'One-off sample');
  assert.equal(db.jobs().length, 1); assert.equal(db.jobs()[0].display_paper_name, 'Configured stock');
  assert.equal(db.jobs(100, 0, true).length, 2);
  assert.equal(db.get('SELECT english_name FROM media_revisions')!.english_name, 'Configured stock');
  db.annotateJob(1, { custom_paper_name: null, hidden: 0 });
  assert.equal(db.get('SELECT display_paper_name FROM job_details WHERE job_id=1')!.display_paper_name, 'Configured stock');
});
test('localized export name yields to explicit job override', t => {
  const { db } = fixture(t), input = sample(); input.records[0].media!.name = 'Papier';
  const result = db.importSnapshot(input); db.attachAnnotations(result.import_id, input);
  assert.equal(input.records[0].accounting?.display_paper_name, 'Papier');
  db.annotateJob(1, { custom_paper_name: 'Sample' }); db.attachAnnotations(result.import_id, input);
  assert.equal(input.records[0].accounting?.display_paper_name, 'Sample');
});
test('reused source record ID preserves both jobs and flags collision', t => {
  const { db } = fixture(t); db.importSnapshot(sample()); const input = sample();
  input.records[0].raw.job_time_at_processing = '20260902100000';
  const result = db.importSnapshot(input);
  assert.equal(result.new_jobs, 1); assert.equal(result.record_id_collisions, 1);
  assert.deepEqual(db.jobs().map(row => row.record_id_collision), [1, 1]);
});
test('revised facts retained and older import cannot roll current version back', t => {
  const { db } = fixture(t); db.importSnapshot(sample()); const changed = sample();
  changed.collected_at = T1; changed.records[0].raw.job_used_ink_C = 200;
  assert.equal(db.importSnapshot(changed).new_observations, 1); db.importSnapshot(sample());
  assert.equal(db.get("SELECT volume_nl FROM job_ink_usage u JOIN print_jobs j ON j.current_observation_id=u.observation_id WHERE channel='C'")!.volume_nl, 200000);
  assert.equal(db.summary().job_observations, 2);
});
test('retention and smaller history never delete archived jobs', t => {
  const { db } = fixture(t); db.importSnapshot(sample()); const input = sample(); input.records = [];
  db.importSnapshot(input); assert.equal(db.summary().print_jobs, 1);
});
test('media rename and removal retain latest name despite older snapshot', t => {
  const { db } = fixture(t); db.importSnapshot(sample()); const changed = sample();
  changed.collected_at = T1; changed.media_catalogue!.collected_at = T1;
  Object.assign(changed.media_catalogue!.entries[MEDIA], { names: { EN: 'New name' }, observed_at: T1, checksum: '5678' });
  db.importSnapshot(changed); db.importSnapshot(sample()); assert.equal(db.jobs()[0].configured_paper_name, 'New name');
  changed.media_catalogue!.entries = {}; changed.media_catalogue!.collected_at = '2026-09-03T12:00:00Z';
  db.importSnapshot(changed); assert.equal(db.get('SELECT present_on_printer FROM media_configs')!.present_on_printer, 0);
  assert.equal(db.jobs()[0].display_paper_name, 'New name');
});
test('partial import failure rolls back facts but records a safe failure category', t => {
  const { db } = fixture(t), input = sample(); input.records.push(structuredClone(input.records[0]));
  assert.throws(() => db.importSnapshot(input)); assert.equal(db.summary().print_jobs, 0); assert.equal(db.summary().media_configs, 0);
  assert.deepEqual(db.get('SELECT status,error_code FROM import_runs'), { status: 'failed', error_code: 'invalid_snapshot' });
});
test('purchases keep exact integer money and refuse fractional or unsafe values', t => {
  const { db } = fixture(t); db.importSnapshot(sample());
  const paper = db.run("INSERT INTO papers(name) VALUES('Paper')"), stock = db.run("INSERT INTO paper_stocks(paper_id,name,format,width_um,height_um) VALUES(?,'A4','sheet',210000,297000)", paper);
  db.run("INSERT INTO paper_purchases(paper_stock_id,purchased_on,packs,sheets_per_pack,price_micros) VALUES(?,'2026-01-01',1,25,?)", stock, Number.MAX_SAFE_INTEGER);
  assert.equal(db.get('SELECT price_micros FROM paper_purchases')!.price_micros, Number.MAX_SAFE_INTEGER);
  assert.throws(() => db.run('UPDATE paper_purchases SET price_micros=1.25')); assert.throws(() => db.run('UPDATE paper_purchases SET packs=0'));
  assert.throws(() => db.run('UPDATE paper_purchases SET price_micros=?', 2 ** 53), /safe range/);
  const input = sample(); input.records[0].raw.job_used_ink_C = Number.MAX_SAFE_INTEGER;
  assert.throws(() => db.importSnapshot(input), /safe range/); assert.equal(db.summary().job_observations, 1);
});
test('fresh database is migrated and marked; reopening is idempotent', t => {
  const { db, path } = fixture(t); db.run("INSERT INTO papers(name) VALUES('Keep this paper')");
  for (let i = 0; i < 2; i++) {
    const reopened = new AccountingDatabase(path);
    try {
      assert.equal(reopened.get('PRAGMA application_id')!.application_id, APPLICATION_ID);
      assert.equal(reopened.all('SELECT * FROM __drizzle_migrations').length, 5);
      assert.equal(reopened.get('SELECT name FROM papers')!.name, 'Keep this paper');
      assert.deepEqual(reopened.all("SELECT name FROM sqlite_master WHERE type='view'"), [{ name: 'job_details' }]);
    } finally { reopened.close(); }
  }
});
test('foreign, unrelated and pre-Drizzle databases are refused untouched', t => {
  const { dir } = fixture(t);
  const make = (name: string, sql: string) => { const path = join(dir, name), raw = new Database(path); raw.exec(sql); raw.close(); return path; };
  const inspect = (path: string) => { const raw = new Database(path); try { return raw.query("SELECT (SELECT count(*) FROM sqlite_master) AS objects, (SELECT application_id FROM pragma_application_id) AS app").get(); } finally { raw.close(); } };
  const foreign = make('foreign.sqlite3', 'PRAGMA application_id=1234');
  assert.throws(() => new AccountingDatabase(foreign), /Not a Print Tally database/); assert.deepEqual(inspect(foreign), { objects: 0, app: 1234 });
  const unrelated = make('unrelated.sqlite3', 'CREATE TABLE unrelated(x)');
  assert.throws(() => new AccountingDatabase(unrelated), /Not a Print Tally database/); assert.deepEqual(inspect(unrelated), { objects: 1, app: 0 });
  const earlier = make('earlier.sqlite3', `CREATE TABLE printers(id INTEGER PRIMARY KEY); PRAGMA application_id=${APPLICATION_ID}`);
  assert.throws(() => new AccountingDatabase(earlier), /earlier version/); assert.deepEqual(inspect(earlier), { objects: 1, app: APPLICATION_ID });
});
test('unrepresentable quantities and wrong-printer catalogue roll back', t => {
  const { db } = fixture(t), input = sample(); input.schema.find(field => field.name === 'job_used_ink_C')!.factor = '3';
  assert.throws(() => db.importSnapshot(input));
  const cross = sample(); cross.media_catalogue!.printer_mac = '000000000000'; assert.throws(() => db.importSnapshot(cross));
  assert.equal(db.summary().print_jobs, 0);
});
