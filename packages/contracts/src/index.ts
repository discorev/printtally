import { z } from 'zod';

// These contracts contain no filesystem, Electron, printer transport or database code.
export const API_VERSION = 1;
const uint = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const fieldSchema = z.object({
  name: z.string().min(1), type: z.enum(['uint', 'string']), order: z.string().optional(),
  unit: z.string().optional(), factor: z.string().regex(/^\d+$/).optional(),
}).catchall(z.string());
export const rawSchema = z.record(z.string(), z.union([z.string(), uint, z.null()]));
const namesSchema = z.object({
  names: z.record(z.string(), z.string()), short_name: z.string().nullable().optional(),
  checksum: z.string().nullable().optional(), observed_at: z.string().optional(),
});
export const catalogueSchema = z.object({
  version: z.literal(1).optional(), printer_mac: z.string().regex(/^[0-9a-f]{12}$/),
  collected_at: z.string(), database_version: z.string().nullable().optional(),
  product_id: z.string().nullable().optional(),
  entries: z.record(z.string(), namesSchema.extend({
    id: z.string().optional(), visible: z.boolean().optional(), present_on_printer: z.boolean(),
    source: z.string().optional(), name_history: z.array(namesSchema).optional(),
  })),
});
export const mediaSchema = z.object({
  id: z.string().nullable().optional(), name: z.string().nullable(), language: z.string().nullable().optional(),
  resolution: z.enum(['printer_current', 'cached_last_known', 'unresolved']).optional(),
  source: z.string().nullable().optional(), observed_at: z.string().nullable().optional(),
  present_on_printer: z.boolean().nullable().optional(),
});
export const recordSchema = z.object({
  raw: rawSchema, media: mediaSchema.optional(),
  quantities: z.record(z.string(), z.object({ value: z.string(), unit: z.string() })).optional(),
  ink_ml: z.record(z.string(), z.string()).optional(), total_ink_ml: z.string().nullable().optional(),
  accounting: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).optional(),
});
export const snapshotSchema = z.object({
  printer: z.object({ host: z.string().min(1), mac: z.string().regex(/^[0-9a-f]{12}$/) }),
  collected_at: z.string(), requested_range: z.tuple([uint, uint]),
  schema: z.array(fieldSchema).min(1), records: z.array(recordSchema),
  media_catalogue: catalogueSchema.optional(), protocol: z.string().optional(),
  retention: uint.optional(), notes: z.array(z.string()).optional(),
});
// paper_stock_id and paper_id each correct a job's default stock allocation; setting one clears the other.
export const annotationSchema = z.object({
  custom_paper_name: z.string().trim().min(1).max(500).nullable().optional(),
  paper_stock_id: uint.positive().nullable().optional(), paper_id: uint.positive().nullable().optional(),
  hidden: z.union([z.literal(0), z.literal(1)]).optional(), notes: z.string().max(10000).nullable().optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'No annotation fields supplied')
  .refine(value => value.paper_stock_id == null || value.paper_id == null, 'Choose a stock item or a paper, not both');
export type Field = z.infer<typeof fieldSchema>;
export type RawRecord = z.infer<typeof rawSchema>;
export type JobRecord = z.infer<typeof recordSchema>;
export type Names = z.infer<typeof namesSchema>;
export type Catalogue = z.infer<typeof catalogueSchema>;
export type MediaEntry = Catalogue['entries'][string];
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Annotation = z.infer<typeof annotationSchema>;
export interface CollectOptions {
  host: string; mac?: string; cacheDirectory: string; trustedCertificatePem?: string; port?: number; // port: tests only (default 443)
  batchSize?: number; limit?: number; mediaLanguage?: string;
}
export interface ImportResult {
  import_id: number; new_jobs: number; new_observations: number;
  record_id_collisions: number; received: number;
}

const nullableText = z.string().nullable();
// Integer strings carry values outside JavaScript's safe range without rounding.
const storedInteger = z.union([z.number().int().safe(), z.string().regex(/^-?\d+$/)]);
export const jobDetailsSchema = z.object({
  job_id: uint, printer_id: uint, source_record_id: uint,
  first_seen_at: z.string(), last_seen_at: z.string(),
  job_name: nullableText, job_owner: nullableText, started_at_raw: nullableText, completed_at_raw: nullableText,
  completion_state: nullableText, job_type: nullableText,
  width_um: storedInteger.nullable(), height_um: storedInteger.nullable(), used_area_mm2: storedInteger.nullable(),
  impressions: storedInteger.nullable(), color_pages: storedInteger.nullable(), monochrome_pages: storedInteger.nullable(), duplex: nullableText,
  source_media_id: nullableText, configured_paper_name: nullableText, paper_name_at_import: nullableText,
  display_paper_name: nullableText, hidden: z.union([z.literal(0), z.literal(1)]), custom_paper_name: nullableText,
  stock_override_id: uint.nullable(), paper_override_id: uint.nullable(), notes: nullableText,
  record_id_collision: z.union([z.literal(0), z.literal(1)]),
});
export type JobDetails = z.infer<typeof jobDetailsSchema>;
// Server status for every client. Collection runs on start, every 15 minutes and on request.
// needs_printer: no printer is known yet (one that needs its password is reported in printers[].state instead).
export type ServerState = 'needs_printer' | 'ready' | 'collecting' | 'printer_needs_confirming';
// needs_confirming: the printer's root certificate changed, so its password is withheld until the user confirms it again.
// local_network_blocked: macOS refused every connection to the printer's address until Local Network access is granted.
export type PrinterState = 'unknown' | 'ready' | 'needs_password' | 'needs_confirming' | 'unreachable' | 'local_network_blocked' | 'failed';
export interface CollectionStatus { at: string; result: 'succeeded' | 'failed'; newJobs: number | null }
export interface PrinterStatus { id: string; name: string; host: string; state: PrinterState; lastCollection: CollectionStatus | null }
// The printer's oldest kept record was newer than the last one collected + 1: records from..to were never collected.
// printerId and printerName are the known printer's (health.printers[].id); null id when it is no longer set up.
export interface MissedJobs { printerId: string | null; printerName: string; fromRecord: number; toRecord: number; detectedAt: string }
// hostName: the server machine's name (without .local), which clients show as the computer they're using.
// version: the printtally package's version (the backend version in Settings).
export interface HealthResponse {
  service: 'printtally'; apiVersion: number; version: string; hostName: string; collecting: boolean; state: ServerState;
  printers: PrinterStatus[]; missedJobs: MissedJobs[]; lastCollection: CollectionStatus | null; nextCollectionAt: string | null;
}

// Pairing another device: `printtally pair` asks the local server for a single-use code, redeemed for a session cookie.
export const pairingCodeRequestSchema = z.object({ label: z.string().trim().min(1).max(100).optional() }).strict();
export const pairingRedeemSchema = z.object({ code: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
export interface PairingCodeResponse { code: string; expiresAt: string; links: string[] }
export interface PairedSession { id: string; label: string; userAgent: string | null; createdAt: string; lastSeenAt: string }
export interface SessionsResponse { sessions: PairedSession[] }
export interface ApiError { error: string }

// GET /imports, newest first. requested_first..requested_last is the printer's job log range when it was read.
export interface ImportRun {
  id: number; printer_id: number | null; source: 'live' | 'snapshot'; started_at: string; finished_at: string | null;
  status: 'running' | 'succeeded' | 'failed'; requested_first: number | null; requested_last: number | null;
  received_count: number | null; new_jobs: number | null; new_observations: number | null; error_code: string | null;
}
export interface ImportsResponse { imports: ImportRun[]; limit: number; offset: number }

// Printer discovery advertises candidates; only an explicit confirmation grants trust.
export const enrolmentRequestSchema = z.object({
  host: z.ipv4(), name: z.string().trim().min(1).max(120).optional(),
  mac: z.string().regex(/^(?:[0-9a-f]{12}|(?:[0-9a-f]{1,2}:){5}[0-9a-f]{1,2})$/i).optional(),
}).strict();
export const fingerprintSchema = z.string().regex(/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/);
export const confirmPrinterSchema = z.object({ fingerprintSha256: fingerprintSchema, confirmed: z.literal(true) }).strict();
export const printerPasswordSchema = z.object({ password: z.string().min(1).max(4096) }).strict();
export interface DiscoveredPrinter {
  host: string; name: string; model: string | null; services: string[];
}
export interface KnownPrinter {
  id: string; host: string; name: string; mac: string | null;
  fingerprintSha256: string; validFrom: string; validTo: string;
  confirmedAt: string; lastVerifiedAt: string;
}
// GET /known-printers. hasPassword: whether the credential store holds the printer's password (null when the
// store couldn't be read); the password itself is never returned.
export interface KnownPrinterListing extends KnownPrinter { hasPassword: boolean | null }
export interface PrinterTrustPreview {
  id: string; host: string; name: string; mac: string | null;
  fingerprintSha256: string; validFrom: string; validTo: string; expiresAt: string;
  existingPrinterId: string | null; previousFingerprintSha256: string | null;
  change: 'new' | 'unchanged' | 'address_changed' | 'root_changed';
}
export type EnrolmentRequest = z.infer<typeof enrolmentRequestSchema>;
export type ConfirmPrinterRequest = z.infer<typeof confirmPrinterSchema>;

export * from './ledger.ts';
