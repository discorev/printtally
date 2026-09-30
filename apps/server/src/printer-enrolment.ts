import { randomUUID, X509Certificate } from 'node:crypto';
import { enrolmentRequestSchema, confirmPrinterSchema, printerPasswordSchema, type KnownPrinter, type KnownPrinterListing, type PrinterTrustPreview, type DiscoveredPrinter, type CollectOptions } from 'print-accounting-contracts';
import { KnownPrinters, TrustConflictError, type StoredPrinter } from 'print-accounting-database';
import { discoverPrinters, isPrinterAddress } from './printer-discovery.ts';
import { inspectPrinter, verifyPrinter } from './printer-certificate.ts';
import { saveVerified, printerPassword, type SecretStore } from './credentials.ts';
import { isLocalNetworkBlocked } from './local-network.ts';
export class EnrolmentError extends Error {
  status: number;
  constructor(code: string, status = 400) { super(code); this.status = status; }
}
interface Dependencies {
  inspect: typeof inspectPrinter; verify: typeof verifyPrinter;
  discover: () => Promise<DiscoveredPrinter[]>; clock: () => number;
}
interface Pending {
  preview: PrinterTrustPreview; rootCertificatePem: string; existing?: StoredPrinter; expires: number;
}
const publicPrinter = ({ rootCertificatePem: _pem, ...printer }: StoredPrinter): KnownPrinter => printer;
const account = (printer: StoredPrinter): string => 'known-printer:' + printer.id + ':' + printer.fingerprintSha256;
export class PrinterEnrolment {
  private known: KnownPrinters;
  private secrets: SecretStore;
  private cacheDirectory: string;
  private dependencies: Dependencies;
  private pending = new Map<string, Pending>();
  private inspecting = 0;
  private discovery?: Promise<DiscoveredPrinter[]>;
  constructor(known: KnownPrinters, secrets: SecretStore, cacheDirectory: string, dependencies: Partial<Dependencies> = {}) {
    this.known = known; this.secrets = secrets; this.cacheDirectory = cacheDirectory;
    this.dependencies = { inspect: inspectPrinter, verify: verifyPrinter, discover: discoverPrinters, clock: Date.now, ...dependencies };
  }
  list(): KnownPrinter[] { return this.known.list().map(publicPrinter); }
  // Checks the credential store for each password; only whether one is there leaves this method.
  listing(): Promise<KnownPrinterListing[]> {
    return Promise.all(this.known.list().map(async printer =>
      ({ ...publicPrinter(printer), hasPassword: await this.secrets.get(account(printer)).then(secret => !!secret, () => null) })));
  }
  async discover(): Promise<DiscoveredPrinter[]> {
    if (!this.discovery) this.discovery = this.dependencies.discover().finally(() => { this.discovery = undefined; });
    try { return await this.discovery; } catch { throw new EnrolmentError('discovery_failed', 502); }
  }
  async preview(input: unknown): Promise<PrinterTrustPreview> {
    const parsed = enrolmentRequestSchema.safeParse(input);
    if (!parsed.success || !isPrinterAddress(parsed.data.host)) throw new EnrolmentError('invalid_printer_address');
    for (const [id, item] of this.pending) if (item.expires <= this.dependencies.clock()) this.pending.delete(id);
    if (this.inspecting >= 4 || this.pending.size + this.inspecting >= 32) throw new EnrolmentError('too_many_previews', 429);
    this.inspecting++;
    try {
      const input = parsed.data;
      let inspected;
      try { inspected = await this.dependencies.inspect(input.host, input.mac); }
      catch (error) { throw new EnrolmentError(isLocalNetworkBlocked(input.host, error) ? 'local_network_blocked' : 'printer_inspection_failed', 502); }
      const root = new X509Certificate(inspected.rootCertificatePem);
      const now = this.dependencies.clock();
      if (!root.ca || root.subject !== root.issuer || !root.verify(root.publicKey) || root.validFromDate.getTime() > now || root.validToDate.getTime() <= now) throw new EnrolmentError('invalid_printer_root', 502);
      const byHost = this.known.atHost(input.host), byRoot = this.known.withRoot(root.fingerprint256);
      if (byHost && byRoot && byHost.id !== byRoot.id) throw new EnrolmentError('printer_identity_conflict', 409);
      const existing = byHost ?? byRoot;
      const change = !existing ? 'new' : existing.fingerprintSha256 !== root.fingerprint256 ? 'root_changed' : existing.host !== input.host ? 'address_changed' : 'unchanged';
      const expires = now + 10 * 60 * 1000;
      const preview: PrinterTrustPreview = {
        id: randomUUID(), host: input.host, name: input.name ?? existing?.name ?? input.host,
        mac: inspected.mac ?? (change !== 'root_changed' ? existing?.mac ?? null : null),
        fingerprintSha256: root.fingerprint256, validFrom: root.validFromDate.toISOString(), validTo: root.validToDate.toISOString(),
        expiresAt: new Date(expires).toISOString(), existingPrinterId: existing?.id ?? null,
        previousFingerprintSha256: existing?.fingerprintSha256 ?? null, change,
      };
      this.pending.set(preview.id, { preview, rootCertificatePem: root.toString(), existing, expires });
      return { ...preview };
    } finally { this.inspecting--; }
  }
  async confirm(id: string, input: unknown): Promise<KnownPrinter> {
    const body = confirmPrinterSchema.safeParse(input);
    if (!body.success) throw new EnrolmentError('confirmation_required');
    const pending = this.pending.get(id);
    if (!pending || pending.expires <= this.dependencies.clock()) {
      this.pending.delete(id); throw new EnrolmentError('preview_expired', 410);
    }
    if (body.data.fingerprintSha256 !== pending.preview.fingerprintSha256) throw new EnrolmentError('fingerprint_mismatch', 409);
    // Consume before I/O to prevent duplicate confirmations racing each other.
    this.pending.delete(id);
    try { await this.dependencies.verify(pending.preview.host, pending.rootCertificatePem); }
    catch { throw new EnrolmentError('printer_verification_failed', 502); }
    if (pending.expires <= this.dependencies.clock()) throw new EnrolmentError('preview_expired', 410);
    const now = new Date(this.dependencies.clock()).toISOString();
    const printer: StoredPrinter = {
      id: pending.existing?.id ?? randomUUID(), host: pending.preview.host, name: pending.preview.name, mac: pending.preview.mac,
      fingerprintSha256: pending.preview.fingerprintSha256, rootCertificatePem: pending.rootCertificatePem,
      validFrom: pending.preview.validFrom, validTo: pending.preview.validTo, confirmedAt: now, lastVerifiedAt: now,
    };
    try { this.known.save(printer, pending.existing); }
    catch (error) { if (error instanceof TrustConflictError) throw new EnrolmentError('preview_stale', 409); throw error; }
    return publicPrinter(printer);
  }
  cancel(id: string): void { this.pending.delete(id); }
  private get(id: string): StoredPrinter {
    const printer = this.known.get(id);
    if (!printer) throw new EnrolmentError('known_printer_not_found', 404);
    return printer;
  }
  async setPassword(id: string, input: unknown): Promise<void> {
    const printer = this.get(id), parsed = printerPasswordSchema.safeParse(input);
    if (!parsed.success) throw new EnrolmentError('invalid_password');
    // A root replacement uses a separate credential account. Never carry an old
    // admin password to a newly trusted device just because it reused an address.
    await saveVerified(this.secrets, account(printer), parsed.data.password);
  }
  collection(id: string): { printer: KnownPrinter; options: CollectOptions; getPassword: () => Promise<string> } {
    const printer = this.get(id);
    return { printer: publicPrinter(printer),
      options: { host: printer.host, mac: printer.mac ?? undefined, trustedCertificatePem: printer.rootCertificatePem, cacheDirectory: this.cacheDirectory },
      getPassword: () => printerPassword(this.secrets, account(printer)),
    };
  }
}
