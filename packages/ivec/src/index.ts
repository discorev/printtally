import { join } from 'node:path';
import { fieldSchema, snapshotSchema, type CollectOptions, type Field, type JobRecord, type Snapshot } from 'print-accounting-contracts';
import { normalized, now } from 'print-accounting-core';
import { Ivec, ProtocolError, checked, elements, value, authenticated, canonicalMac, resolveMac, readBatch } from './protocol.ts';
import { collectCatalog, resolveMedia } from './media.ts';
export { Ivec, ProtocolError } from './protocol.ts';
export function validateOptions(options: CollectOptions): void {
  const batch = options.batchSize ?? 20;
  if (!Number.isInteger(batch) || batch < 1 || batch > 20) throw new Error('Batch size must be 1–20');
  if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 1)) throw new Error('Limit must be positive');
  if (!/^[A-Z]{2,8}$/.test(options.mediaLanguage ?? 'EN')) throw new Error('Invalid media language');
}
async function capabilities(client: Ivec): Promise<{ schema: Field[]; retention: number; authType: string | null }> {
  const [root, payload] = checked(await client.request('GetCapability'), 'GetCapability');
  const node = elements(root, 'ivec:joblog_record_format')[0];
  if (payload.length || !node) throw new ProtocolError('Printer did not advertise a job schema');
  const fields: Field[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType !== 1) continue;
    const attributes = (child as Element).attributes;
    const field: Record<string, string> = {};
    for (let i = 0; i < attributes.length; i++) { const attr = attributes.item(i)!; field[attr.name] = attr.value; }
    fields.push(fieldSchema.parse(field));
  }
  fields.sort((a, b) => Number(a.order) - Number(b.order));
  if (fields.length !== Number(node.getAttribute('number')) || !fields.length || new Set(fields.map(field => field.name)).size !== fields.length || fields.some(field => !/^\d+$/.test(field.order ?? ''))) throw new ProtocolError('Invalid job schema');
  // Records kept on the printer, not the highest record number (reported separately as 4294967295).
  const retention = Number(value(root, 'ivec:joblog_stored_record_max_number') ?? '0');
  if (!Number.isSafeInteger(retention) || retention < 0) throw new ProtocolError('Invalid retention');
  return { schema: fields, retention, authType: value(root, 'vcn:auth_type') };
}
export async function probe(host: string, trustedCertificatePem?: string): Promise<{ schema: Field[]; retention: number; authType: string | null }> {
  const client = new Ivec(host, { trustedCertificatePem });
  try { return await capabilities(client); } finally { client.close(); }
}
export async function collectSnapshot(options: CollectOptions, getPassword: () => Promise<string>, progress: (message: string) => void = () => {}): Promise<Snapshot> {
  validateOptions(options);
  const client = new Ivec(options.host, { port: options.port, trustedCertificatePem: options.trustedCertificatePem });
  try {
    const { schema, retention, authType } = await capabilities(client);
    if (authType !== 'type1') throw new ProtocolError('Unsupported printer authentication type');
    progress(`IVEC: ${schema.length} job fields; retention up to ${retention} records`);
    const password = await getPassword();
    const [status] = await authenticated(client, 'GetStatus', password);
    const text = value(status, 'ivec:joblog_range') ?? '';
    if (!/^\d+:\d+$/.test(text)) throw new ProtocolError('Printer returned an unsupported or empty record range');
    let [first, last] = text.split(':').map(Number);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first || last - first > 100000) throw new ProtocolError('Printer returned an invalid record range');
    if (options.limit) first = Math.max(first, last - options.limit + 1);
    const mac = options.mac ? canonicalMac(options.mac) : resolveMac(options.host);
    const jobs = new Map<number, JobRecord>();
    const batchSize = options.batchSize ?? 20;
    for (let begin = first; begin <= last; begin += batchSize) {
      const end = Math.min(last, begin + batchSize - 1);
      const batch = await readBatch(client, password, mac, begin, end, schema);
      for (const raw of batch) {
        const id = raw.job_record_number;
        if (typeof id !== 'number' || id < begin || id > end || jobs.has(id)) throw new ProtocolError('Unexpected or duplicate job record ID');
        jobs.set(id, normalized(raw, schema));
      }
      progress(`Read range ${begin}–${end}: ${batch.length} records`);
    }
    const catalogue = await collectCatalog(client, mac, join(options.cacheDirectory, 'media-' + mac + '.json'));
    const records = [...jobs.entries()].sort(([a], [b]) => a - b).map(([, record]) => record);
    for (const record of records) record.media = resolveMedia(typeof record.raw.job_media_type_name === 'string' ? record.raw.job_media_type_name : null, catalogue, options.mediaLanguage);
    progress(`Resolved media names for ${records.filter(record => record.media?.name).length}/${records.length} jobs`);
    return snapshotSchema.parse({ printer: { host: options.host, mac }, protocol: 'Canon IVEC joblog', collected_at: now(), requested_range: [first, last], retention, schema, records, media_catalogue: catalogue, notes: ['Raw integer quantities use schema factors.', 'Printer timestamps have no confirmed timezone.', 'Media names are current or last-observed configuration, not verified job-time names.'] });
  } finally { client.close(); }
}
