import { createHash } from 'node:crypto';
import type { Field, JobRecord, RawRecord } from 'print-accounting-contracts';

// Canonical JSON: sorted keys, compact separators, non-ASCII left unescaped.
// A stable encoding is required so identity hashes stay consistent for existing archives.
export function encoded(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(encoded).join(',') + ']';
  if (typeof value === 'object' && value !== null) {
    const data = value as Record<string, unknown>;
    return '{' + Object.keys(data).sort().map(key => JSON.stringify(key) + ':' + encoded(data[key])).join(',') + '}';
  }
  throw new Error('Unsupported canonical JSON value');
}
export function digest(value: unknown): string {
  return createHash('sha256').update(encoded(value)).digest('hex');
}
export function timestamp(value: string): string {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(value)) {
    throw new Error('Observation timestamps require an explicit timezone and at most microsecond precision');
  }
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) throw new Error('Invalid observation time');
  const fraction = (value.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0');
  return date.toISOString().replace(/\.\d{3}Z$/, '.' + fraction + '+00:00');
}
export const now = (): string => timestamp(new Date().toISOString());
export function unsigned(value: unknown): bigint {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  throw new Error('Invalid unsigned integer');
}
export function factor(field: Field): bigint {
  const result = unsigned(field.factor ?? '1');
  if (result === 0n) throw new Error('Invalid quantity factor');
  return result;
}
export function scaled(raw: RawRecord, fields: Map<string, Field>, name: string, unit: string, scale: bigint): bigint | null {
  const amount = raw[name];
  if (amount == null) return null;
  const field = fields.get(name);
  if (!field || field.unit !== unit || field.type !== 'uint') throw new Error('Unexpected quantity schema');
  const numerator = unsigned(amount) * scale;
  const denominator = factor(field);
  if (numerator % denominator !== 0n) throw new Error('Quantity cannot be represented exactly');
  const result = numerator / denominator;
  if (result > 9223372036854775807n) throw new Error('Quantity exceeds SQLite integer range');
  return result;
}
export function decimal(numerator: bigint, denominator: bigint): string {
  if (denominator <= 0n || numerator < 0n) throw new Error('Invalid decimal quantity');
  const whole = numerator / denominator;
  let remainder = numerator % denominator;
  let suffix = '';
  // Observed protocol factors are powers of ten. Never silently round other factors.
  while (remainder && suffix.length < 40) {
    remainder *= 10n;
    suffix += String(remainder / denominator);
    remainder %= denominator;
  }
  if (remainder) throw new Error('Non-terminating decimal quantity');
  return String(whole) + (suffix ? '.' + suffix : '');
}
export function normalized(raw: RawRecord, schema: Field[]): JobRecord {
  const quantities: NonNullable<JobRecord['quantities']> = {};
  const ink: Record<string, string> = {};
  let inkNumerator = 0n, inkDenominator = 1n, expectedInk = 0;
  for (const field of schema) {
    const isInk = field.name.startsWith('job_used_ink_');
    if (isInk) expectedInk++;
    const amount = raw[field.name];
    if (amount != null && ['ml', 'mm', 'm2'].includes(field.unit ?? '')) {
      const numerator = unsigned(amount), denominator = factor(field);
      const value = decimal(numerator, denominator);
      quantities[field.name] = { value, unit: field.unit! };
      if (isInk) {
        ink[field.name.slice('job_used_ink_'.length)] = value;
        inkNumerator = inkNumerator * denominator + numerator * inkDenominator;
        inkDenominator *= denominator;
      }
    }
  }
  return { raw, quantities, ink_ml: ink, total_ink_ml: Object.keys(ink).length === expectedInk ? decimal(inkNumerator, inkDenominator) : null };
}
export function csvExport(records: JobRecord[], schema: Field[]): string {
  const names = schema.map(field => field.name);
  const cell = (value: unknown): string => {
    let text = value == null ? '' : String(value);
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
  };
  const rows: unknown[][] = [[...names, 'total_ink_ml', 'media_name', 'media_resolution', 'database_job_id', 'hidden', 'configured_media_name']];
  for (const record of records) rows.push([
    ...names.map(name => record.raw[name]), record.total_ink_ml,
    record.accounting?.display_paper_name ?? record.media?.name,
    record.media?.resolution ?? 'unresolved', record.accounting?.job_id,
    record.accounting?.hidden ?? 0, record.media?.name,
  ]);
  return rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
