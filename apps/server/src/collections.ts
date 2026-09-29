import { X509Certificate } from 'node:crypto';
import { hostname } from 'node:os';
import type { CollectionStatus, HealthResponse, ImportResult, KnownPrinter, PrinterState } from 'print-accounting-contracts';
import { API_VERSION } from 'print-accounting-contracts';
import type { AccountingService } from './service.ts';
import type { PrinterEnrolment } from './printer-enrolment.ts';
import { MissingCredentialError } from './credentials.ts';
import { downloadPrinterRoot } from './printer-certificate.ts';
import { COLLECTION_INTERVAL_MS } from './config.ts';

export class CollectionError extends Error {
  state: PrinterState;
  constructor(state: PrinterState) { super(state); this.state = state; }
}
interface Status { state: PrinterState; lastCollection: CollectionStatus | null }
export interface CollectionOptions { intervalMs?: number; inspectRoot?: (host: string) => Promise<string>; clock?: () => number }
// Collects every known printer on start and on an interval, and on request. All collections run
// one at a time; a request for a printer already queued or collecting shares that collection.
export class Collections {
  private service: AccountingService;
  private enrolment: PrinterEnrolment;
  private intervalMs: number;
  private inspectRoot: (host: string) => Promise<string>;
  private clock: () => number;
  // Keyed by printer and root fingerprint, so a newly confirmed root starts with a clean status.
  private status = new Map<string, Status>();
  private queue: Promise<unknown> = Promise.resolve();
  private inFlight = new Map<string, Promise<ImportResult>>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private nextAt: number | undefined;
  private sweeping = false;
  constructor(service: AccountingService, enrolment: PrinterEnrolment, options: CollectionOptions = {}) {
    this.service = service; this.enrolment = enrolment;
    this.intervalMs = options.intervalMs ?? COLLECTION_INTERVAL_MS;
    this.inspectRoot = options.inspectRoot ?? (host => downloadPrinterRoot(host));
    this.clock = options.clock ?? Date.now;
  }
  private key(printer: Pick<KnownPrinter, 'id' | 'fingerprintSha256'>): string { return printer.id + ':' + printer.fingerprintSha256; }
  collect(id: string): Promise<ImportResult> {
    const existing = this.inFlight.get(id);
    if (existing) return existing;
    const run = this.queue.then(() => this.run(id));
    const settle = (): void => { this.inFlight.delete(id); };
    this.queue = run.then(settle, settle);
    this.inFlight.set(id, run);
    return run;
  }
  private async run(id: string): Promise<ImportResult> {
    const selected = this.enrolment.collection(id), key = this.key(selected.printer);
    let asked = false;
    const getPassword = (): Promise<string> => { asked = true; return selected.getPassword(); };
    const record = (state: PrinterState, result: ImportResult | undefined): void => {
      this.status.set(key, { state, lastCollection: { at: new Date(this.clock()).toISOString(), result: result ? 'succeeded' : 'failed', newJobs: result?.new_jobs ?? null } });
    };
    try {
      const { result } = await this.service.collect(selected.options, getPassword);
      record('ready', result);
      return result;
    } catch (error) {
      // A password is only read once the printer has proved it holds the confirmed root, so a
      // failure before that point is either an unreachable printer or a changed certificate.
      const state = error instanceof MissingCredentialError ? 'needs_password' : asked ? 'failed' : await this.diagnose(selected.options.host, selected.options.trustedCertificatePem!);
      record(state, undefined);
      throw new CollectionError(state);
    }
  }
  private async diagnose(host: string, trusted: string): Promise<PrinterState> {
    let presented: string;
    try { presented = await this.inspectRoot(host); } catch { return 'unreachable'; }
    return new X509Certificate(presented).fingerprint256 === new X509Certificate(trusted).fingerprint256 ? 'failed' : 'needs_confirming';
  }
  async collectAll(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try { for (const printer of this.enrolment.list()) await this.collect(printer.id).catch(() => undefined); }
    finally { this.sweeping = false; }
  }
  start(): void {
    this.nextAt = this.clock() + this.intervalMs;
    this.timer = setInterval(() => { this.nextAt = this.clock() + this.intervalMs; void this.collectAll(); }, this.intervalMs);
    void this.collectAll();
  }
  // Stops the schedule and waits for a running collection, so the database can close safely.
  async stop(): Promise<void> {
    clearInterval(this.timer); this.timer = undefined; this.nextAt = undefined;
    await this.queue;
  }
  // A newly confirmed printer or root has no password yet; an address change keeps its status.
  confirmed(printer: KnownPrinter): void {
    if (!this.status.has(this.key(printer))) this.status.set(this.key(printer), { state: 'needs_password', lastCollection: null });
  }
  passwordSaved(id: string): void {
    const printer = this.enrolment.list().find(item => item.id === id);
    if (printer) this.status.set(this.key(printer), { state: 'unknown', lastCollection: this.status.get(this.key(printer))?.lastCollection ?? null });
  }
  health(): HealthResponse {
    const known = this.enrolment.list();
    const missedJobs = this.service.db.missedJobs().map(({ mac, host, ...gap }) => {
      const printer = known.find(item => item.mac?.toLowerCase() === mac) ?? known.find(item => item.host === host);
      return { printerId: printer?.id ?? null, printerName: printer?.name ?? mac, ...gap };
    });
    const printers = known.map(printer => {
      const status = this.status.get(this.key(printer));
      return { id: printer.id, name: printer.name, host: printer.host, state: status?.state ?? 'unknown', lastCollection: status?.lastCollection ?? null };
    });
    const last = printers.map(printer => printer.lastCollection).filter(item => item !== null).sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
    const state = this.service.busy ? 'collecting' : printers.every(printer => printer.state === 'needs_password') ? 'needs_printer'
      : printers.some(printer => printer.state === 'needs_confirming') ? 'printer_needs_confirming' : 'ready';
    return { service: 'printtally', apiVersion: API_VERSION, hostName: hostname().replace(/\.local$/i, ''), collecting: this.service.busy, state, printers, missedJobs, lastCollection: last,
      nextCollectionAt: this.nextAt === undefined ? null : new Date(this.nextAt).toISOString() };
  }
}
