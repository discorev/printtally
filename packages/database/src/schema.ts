import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, primaryKey, sqliteTable, sqliteView, text, unique, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

// All UTC observation times are ISO 8601 text. Printer job times remain raw text.
// Money: integer millionths of the named currency. No floating-point monetary values.
// Length: micrometres; area: square millimetres; ink: nanolitres (1 ml = 1,000,000 nl).
// Price effective_from dates are local calendar dates; costs are not calculated yet.
// Drizzle cannot declare DEFERRABLE foreign keys: drizzle/*_initial.sql adds
// DEFERRABLE INITIALLY DEFERRED to the two current-revision/observation keys by hand.
const mac = (column: string) => sql.raw(`length(${column})=12 AND ${column} NOT GLOB '*[^0-9a-f]*'`);
const date = (column: string) => sql.raw(`length(${column})=10 AND date(${column}) IS NOT NULL AND date(${column})=${column}`);
const currency = (column: string) => sql.raw(`length(${column})=3 AND ${column} NOT GLOB '*[^A-Z]*'`);
const money = (column: string) => sql.raw(`typeof(${column})='integer' AND ${column} >= 0`);
const nonEmpty = (column: string) => sql.raw(`length(trim(${column})) > 0`);
const json = (column: string) => sql.raw(`json_valid(${column})`);
const flag = (column: string) => sql.raw(`${column} IN (0,1)`);
const atLeast = (column: string, minimum: 0 | 1) => sql.raw(minimum ? `${column} > 0` : `${column} >= 0`);

export const printers = sqliteTable('printers', {
  id: integer().primaryKey(),
  mac: text().notNull().unique(),
  display_name: text(),
  model: text(), // Unknown until actually identified.
  timezone: text(), // Unknown until confirmed by the user/device.
  last_host: text().notNull(),
  first_seen_at: text().notNull(),
  last_seen_at: text().notNull(),
  media_observed_at: text(),
}, () => [check('printers_mac_check', mac('mac'))]);

export const import_runs = sqliteTable('import_runs', {
  id: integer().primaryKey(),
  printer_id: integer().references(() => printers.id),
  source: text({ enum: ['live', 'snapshot'] }).notNull(),
  source_host: text(),
  started_at: text().notNull(),
  finished_at: text(),
  status: text({ enum: ['running', 'succeeded', 'failed'] }).notNull(),
  observed_at: text(),
  requested_first: integer(),
  requested_last: integer(),
  received_count: integer(),
  new_jobs: integer(),
  new_observations: integer(),
  record_id_collisions: integer(),
  schema_json: text(),
  error_code: text(), // Sanitized category, never secrets/tracebacks.
}, () => [
  check('import_runs_source_check', sql`source IN ('live','snapshot')`),
  check('import_runs_status_check', sql`status IN ('running','succeeded','failed')`),
  check('import_runs_schema_json_check', sql`schema_json IS NULL OR json_valid(schema_json)`),
]);

export const media_configs = sqliteTable('media_configs', {
  id: integer().primaryKey(),
  printer_id: integer().notNull().references(() => printers.id),
  source_media_id: text().notNull(),
  present_on_printer: integer(),
  visible: integer(),
  current_revision_id: integer(),
  first_seen_at: text().notNull(),
  last_seen_at: text().notNull(),
}, t => [
  unique().on(t.printer_id, t.source_media_id),
  foreignKey({ columns: [t.id, t.current_revision_id], foreignColumns: [media_revisions.media_id, media_revisions.id] }), // DEFERRABLE INITIALLY DEFERRED
  check('media_configs_present_on_printer_check', flag('present_on_printer')),
  check('media_configs_visible_check', flag('visible')),
]);

export const media_revisions = sqliteTable('media_revisions', {
  id: integer().primaryKey(),
  media_id: integer().notNull().references((): AnySQLiteColumn => media_configs.id),
  content_hash: text().notNull(),
  names_json: text().notNull(),
  short_name: text(),
  english_name: text(),
  checksum: text(),
  first_observed_at: text().notNull(),
  last_observed_at: text().notNull(),
}, t => [
  unique().on(t.media_id, t.content_hash),
  unique().on(t.media_id, t.id),
  check('media_revisions_names_json_check', json('names_json')),
]);

export const print_jobs = sqliteTable('print_jobs', {
  id: integer().primaryKey(),
  printer_id: integer().notNull().references(() => printers.id),
  source_record_id: integer().notNull(),
  identity_hash: text().notNull(), // Record ID + start time + name + owner.
  identity_json: text().notNull(),
  first_seen_at: text().notNull(),
  last_seen_at: text().notNull(),
  current_observation_id: integer(),
}, t => [
  unique().on(t.printer_id, t.source_record_id, t.identity_hash),
  foreignKey({ columns: [t.id, t.current_observation_id], foreignColumns: [job_observations.job_id, job_observations.id] }), // DEFERRABLE INITIALLY DEFERRED
  index('jobs_source_id').on(t.printer_id, t.source_record_id),
  check('print_jobs_source_record_id_check', atLeast('source_record_id', 0)),
  check('print_jobs_identity_json_check', json('identity_json')),
]);

export const job_observations = sqliteTable('job_observations', {
  id: integer().primaryKey(),
  job_id: integer().notNull().references((): AnySQLiteColumn => print_jobs.id),
  content_hash: text().notNull(),
  first_import_id: integer().notNull().references(() => import_runs.id),
  first_observed_at: text().notNull(),
  last_observed_at: text().notNull(),
  raw_json: text().notNull(),
  media_config_id: integer().references(() => media_configs.id),
  resolved_media_name: text(), // Name seen on import, not asserted at print time.
  job_name: text(),
  job_owner: text(),
  started_at_raw: text(),
  completed_at_raw: text(),
  completion_state: text(),
  job_type: text(),
  width_um: integer(),
  height_um: integer(),
  used_area_mm2: integer(),
  impressions: integer(),
  color_pages: integer(),
  monochrome_pages: integer(),
  duplex: text(),
}, t => [
  unique().on(t.job_id, t.content_hash),
  unique().on(t.job_id, t.id),
  index('jobs_started').on(t.started_at_raw),
  check('job_observations_raw_json_check', json('raw_json')),
  ...(['width_um', 'height_um', 'used_area_mm2', 'impressions', 'color_pages', 'monochrome_pages'] as const)
    .map(column => check(`job_observations_${column}_check`, atLeast(column, 0))),
]);

export const job_ink_usage = sqliteTable('job_ink_usage', {
  observation_id: integer().notNull().references(() => job_observations.id),
  channel: text().notNull(),
  volume_nl: integer(), // NULL means unknown, never implicitly zero.
}, t => [
  primaryKey({ columns: [t.observation_id, t.channel] }),
  check('job_ink_usage_volume_nl_check', atLeast('volume_nl', 0)),
]);

export const import_job_observations = sqliteTable('import_job_observations', {
  import_id: integer().notNull().references(() => import_runs.id),
  job_id: integer().notNull().references(() => print_jobs.id),
  observation_id: integer().notNull(),
}, t => [
  primaryKey({ columns: [t.import_id, t.job_id] }),
  foreignKey({ columns: [t.job_id, t.observation_id], foreignColumns: [job_observations.job_id, job_observations.id] }),
]);

export const paper_stocks = sqliteTable('paper_stocks', {
  id: integer().primaryKey(),
  name: text().notNull(),
  brand: text(),
  product_code: text(),
  format: text({ enum: ['sheet', 'roll'] }).notNull(),
  width_um: integer(),
  height_um: integer(),
  notes: text(),
}, () => [
  check('paper_stocks_name_check', nonEmpty('name')),
  check('paper_stocks_format_check', sql`format IN ('sheet','roll')`),
  check('paper_stocks_width_um_check', atLeast('width_um', 1)),
  check('paper_stocks_height_um_check', atLeast('height_um', 1)),
]);

// Explicit defaults by media AND paper size. No defaults are inferred during import.
export const media_stock_mappings = sqliteTable('media_stock_mappings', {
  id: integer().primaryKey(),
  media_config_id: integer().notNull().references(() => media_configs.id),
  width_um: integer().notNull(),
  height_um: integer().notNull(),
  effective_from: text().notNull(),
  paper_stock_id: integer().notNull().references(() => paper_stocks.id),
}, t => [
  unique().on(t.media_config_id, t.width_um, t.height_um, t.effective_from),
  check('media_stock_mappings_width_um_check', atLeast('width_um', 1)),
  check('media_stock_mappings_height_um_check', atLeast('height_um', 1)),
  check('media_stock_mappings_effective_from_check', date('effective_from')),
]);

// Each row is a whole pack/length price, not a rounded per-sheet unit price.
// The next effective_from date ends a prior price in the same stock/currency/unit.
export const paper_prices = sqliteTable('paper_prices', {
  id: integer().primaryKey(),
  paper_stock_id: integer().notNull().references(() => paper_stocks.id),
  effective_from: text().notNull(),
  currency: text().notNull(),
  amount_micros: integer().notNull(),
  quantity: integer().notNull(),
  quantity_unit: text({ enum: ['sheet', 'mm'] }).notNull(),
  notes: text(),
}, t => [
  unique().on(t.paper_stock_id, t.currency, t.quantity_unit, t.effective_from),
  check('paper_prices_effective_from_check', date('effective_from')),
  check('paper_prices_currency_check', currency('currency')),
  check('paper_prices_amount_micros_check', money('amount_micros')),
  check('paper_prices_quantity_check', sql`typeof(quantity)='integer' AND quantity > 0`),
  check('paper_prices_quantity_unit_check', sql`quantity_unit IN ('sheet','mm')`),
]);

export const ink_products = sqliteTable('ink_products', {
  id: integer().primaryKey(),
  name: text().notNull(),
  channel: text().notNull(),
  capacity_nl: integer().notNull(),
  product_code: text(),
}, () => [
  check('ink_products_name_check', nonEmpty('name')),
  check('ink_products_capacity_nl_check', atLeast('capacity_nl', 1)),
]);

export const printer_ink_mappings = sqliteTable('printer_ink_mappings', {
  printer_id: integer().notNull().references(() => printers.id),
  channel: text().notNull(),
  effective_from: text().notNull(),
  ink_product_id: integer().notNull().references(() => ink_products.id),
}, t => [
  primaryKey({ columns: [t.printer_id, t.channel, t.effective_from] }),
  check('printer_ink_mappings_effective_from_check', date('effective_from')),
]);

export const ink_prices = sqliteTable('ink_prices', {
  id: integer().primaryKey(),
  ink_product_id: integer().notNull().references(() => ink_products.id),
  effective_from: text().notNull(),
  currency: text().notNull(),
  amount_micros: integer().notNull(),
  cartridge_count: integer().notNull().default(1),
  notes: text(),
}, t => [
  unique().on(t.ink_product_id, t.currency, t.effective_from),
  check('ink_prices_effective_from_check', date('effective_from')),
  check('ink_prices_currency_check', currency('currency')),
  check('ink_prices_amount_micros_check', money('amount_micros')),
  check('ink_prices_cartridge_count_check', sql`typeof(cartridge_count)='integer' AND cartridge_count > 0`),
]);

// This table belongs to the user. The importer NEVER writes it.
export const job_annotations = sqliteTable('job_annotations', {
  job_id: integer().primaryKey().references(() => print_jobs.id),
  custom_paper_name: text(),
  paper_stock_id: integer().references(() => paper_stocks.id),
  hidden: integer().notNull().default(0),
  notes: text(),
  physical_sheet_count: integer(),
  paper_cost_override_micros: integer(),
  paper_cost_currency: text(),
  updated_at: text().notNull(),
}, () => [
  check('job_annotations_custom_paper_name_check', sql`custom_paper_name IS NULL OR length(trim(custom_paper_name)) > 0`),
  check('job_annotations_hidden_check', flag('hidden')),
  check('job_annotations_physical_sheet_count_check', atLeast('physical_sheet_count', 0)),
  check('job_annotations_paper_cost_override_micros_check', sql`paper_cost_override_micros IS NULL OR (${money('paper_cost_override_micros')})`),
  check('job_annotations_paper_cost_currency_check', currency('paper_cost_currency')),
  check('job_annotations_paper_cost_check', sql`(paper_cost_override_micros IS NULL) = (paper_cost_currency IS NULL)`),
]);

export const job_cost_adjustments = sqliteTable('job_cost_adjustments', {
  id: integer().primaryKey(),
  job_id: integer().notNull().references(() => print_jobs.id),
  description: text().notNull(),
  amount_micros: integer().notNull(),
  currency: text().notNull(),
  created_at: text().notNull(),
}, () => [
  check('job_cost_adjustments_description_check', nonEmpty('description')),
  check('job_cost_adjustments_amount_micros_check', sql`typeof(amount_micros)='integer'`),
  check('job_cost_adjustments_currency_check', currency('currency')),
]);

// A known connection is distinct from printers, which identifies archived jobs
// by observed MAC. Enrolment never creates, merges or deletes job history.
export const known_printers = sqliteTable('known_printers', {
  id: text().primaryKey(),
  host: text().notNull().unique(),
  name: text().notNull(),
  mac: text(),
  root_certificate_pem: text().notNull(),
  root_fingerprint_sha256: text().notNull().unique(),
  root_valid_from: text().notNull(),
  root_valid_to: text().notNull(),
  confirmed_at: text().notNull(),
  last_verified_at: text().notNull(),
}, () => [check('known_printers_mac_check', sql`mac IS NULL OR (${mac('mac')})`)]);

// Includes hidden jobs deliberately. UI/report callers explicitly filter hidden=0.
// Unknown names remain NULL; source_media_id is always separately available.
export const job_details = sqliteView('job_details', {
  job_id: integer().notNull(), printer_id: integer().notNull(), source_record_id: integer().notNull(),
  first_seen_at: text().notNull(), last_seen_at: text().notNull(),
  job_name: text(), job_owner: text(), started_at_raw: text(), completed_at_raw: text(),
  completion_state: text(), job_type: text(), width_um: integer(), height_um: integer(), used_area_mm2: integer(),
  impressions: integer(), color_pages: integer(), monochrome_pages: integer(), duplex: text(),
  source_media_id: text(), configured_paper_name: text(), paper_name_at_import: text(), display_paper_name: text(),
  hidden: integer().notNull(), custom_paper_name: text(), stock_override_id: integer(), notes: text(),
  physical_sheet_count: integer(), paper_cost_override_micros: integer(), paper_cost_currency: text(),
  record_id_collision: integer().notNull(),
}).as(sql`SELECT j.id AS job_id, j.printer_id, j.source_record_id,
       j.first_seen_at, j.last_seen_at,
       o.job_name, o.job_owner, o.started_at_raw, o.completed_at_raw,
       o.completion_state, o.job_type, o.width_um, o.height_um, o.used_area_mm2,
       o.impressions, o.color_pages, o.monochrome_pages, o.duplex,
       m.source_media_id, r.english_name AS configured_paper_name,
       o.resolved_media_name AS paper_name_at_import,
       COALESCE(a.custom_paper_name, s.name, r.english_name, r.short_name,
                o.resolved_media_name) AS display_paper_name,
       COALESCE(a.hidden, 0) AS hidden, a.custom_paper_name,
       a.paper_stock_id AS stock_override_id, a.notes,
       a.physical_sheet_count, a.paper_cost_override_micros, a.paper_cost_currency,
       CASE WHEN EXISTS(SELECT 1 FROM print_jobs other
                        WHERE other.printer_id=j.printer_id
                          AND other.source_record_id=j.source_record_id
                          AND other.id<>j.id) THEN 1 ELSE 0 END AS record_id_collision
FROM print_jobs j
JOIN job_observations o ON o.id=j.current_observation_id
LEFT JOIN media_configs m ON m.id=o.media_config_id
LEFT JOIN media_revisions r ON r.id=m.current_revision_id
LEFT JOIN job_annotations a ON a.job_id=j.id
LEFT JOIN paper_stocks s ON s.id=a.paper_stock_id`);
