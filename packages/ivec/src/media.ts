import { existsSync, readFileSync } from 'node:fs';
import { catalogueSchema, type Catalogue, type MediaEntry, type Names, type JobRecord } from 'print-accounting-contracts';
import { encoded, now } from 'print-accounting-core';
import { ProtocolError, canonicalMac, checked, elements, value, parseXml, type Transport, type Params } from './protocol.ts';
import { secureWrite } from './files.ts';
export const MEDIA_ID = /^custom-media-type-canon-[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;
export function parseNames(payload: Buffer): Names {
  if (payload.length > 1024 * 1024) throw new ProtocolError('Oversized media-name XML');
  const root = parseXml(payload).documentElement;
  if (!root || root.tagName !== 'medianame') throw new ProtocolError('Unexpected media-name document');
  const names: Record<string, string> = {};
  for (const element of Array.from(root.getElementsByTagName('medianame_item'))) {
    if (element.parentNode !== root) continue;
    const language = (element.getAttribute('language') ?? '').toUpperCase();
    const name = (element.textContent ?? '').trim();
    if (!/^[A-Z]{2,8}$/.test(language) || !name) continue;
    if (names[language] && names[language] !== name) throw new ProtocolError('Conflicting media names for one language');
    names[language] = name;
  }
  const short_name = root.getElementsByTagName('medianame_item_short')[0]?.textContent?.trim() || null;
  if (!Object.keys(names).length && !short_name) throw new ProtocolError('Empty media-name document');
  return { names, short_name };
}
export function selectName(entry: Names, language = 'EN'): [string | null, string | null] {
  if (entry.names[language.toUpperCase()]) return [entry.names[language.toUpperCase()], language.toUpperCase()];
  if (entry.names.EN) return [entry.names.EN, 'EN'];
  if (entry.short_name) return [entry.short_name, null];
  const fallback = Object.keys(entry.names).sort()[0];
  return fallback ? [entry.names[fallback], fallback] : [null, null];
}
type Header = Record<string, { checksum: string | null; visible: boolean }>;
type Metadata = { database_version?: string | null; product_id?: string | null };
// Media catalogue reads need no admin authentication, unlike the job log.
export async function readHeader(client: Transport): Promise<[Header, Metadata]> {
  const [root, payload] = checked(await client.request('GetCapability', [['ivec:format', 'pop_header'], ['ivec:temp_buffer', 'OFF']], 'media'), 'GetCapability', undefined, 'media');
  if (payload.length || value(root, 'ivec:format') !== 'pop_header') throw new ProtocolError('Unexpected media catalogue response');
  const entries: Header = {};
  for (const element of elements(root, 'ivec:papertype_info')) {
    const id = element.getAttribute('id') ?? '';
    if (!MEDIA_ID.test(id) || entries[id]) throw new ProtocolError('Invalid or duplicate printer media identifier');
    entries[id] = { checksum: value(element, 'ivec:checksum'), visible: value(element, 'ivec:visible') === 'ON' };
  }
  if (!Object.keys(entries).length) throw new ProtocolError('Printer returned an empty media catalogue');
  return [entries, { database_version: value(root, 'ivec:pop-db-time'), product_id: value(root, 'ivec:product_id') }];
}
export async function readNames(client: Transport, mediaId: string): Promise<Names> {
  if (!MEDIA_ID.test(mediaId)) throw new ProtocolError('Invalid printer media identifier');
  const [start, data] = checked(await client.request('StartResource', [['ivec:bidi', '1']], 'media'), 'StartResource', undefined, 'media');
  const jobId = value(start, 'ivec:jobID');
  if (data.length || !jobId || !/^[0-9A-Fa-f]{8}$/.test(jobId)) throw new ProtocolError('Invalid media resource identifier');
  const session: Params = [['ivec:jobID', jobId]];
  let failed = false;
  try {
    const [root, payload] = checked(await client.request('ReceiveData', [...session, ['ivec:format', 'media_name'], ['ivec:papertype', 'custom-media-type-canon-custom'], ['ivec:custom_papertype', mediaId]], 'media'), 'ReceiveData', undefined, 'media');
    if (value(root, 'ivec:jobID') !== jobId || value(root, 'ivec:format') !== 'media_name') throw new ProtocolError('Media resource response mismatch');
    if (![null, '', 'OFF'].includes(value(root, 'ivec:continue'))) throw new ProtocolError('Multipart media-name response unsupported');
    if (String(payload.length) !== value(root, 'ivec:datasize')) throw new ProtocolError('Media-name payload length mismatch');
    return parseNames(payload);
  } catch (error) { failed = true; throw error; }
  finally { try { checked(await client.request('EndResource', session, 'media'), 'EndResource', undefined, 'media'); } catch (error) { if (!failed) throw error; } }
}
export function mergeCatalog(previous: Catalogue | undefined, current: Record<string, Names & { visible: boolean }>, mac: string, observedAt: string, metadata: Metadata): Catalogue {
  if (previous && previous.printer_mac !== mac) throw new ProtocolError('Media cache belongs to another printer');
  const entries: Record<string, MediaEntry> = structuredClone(previous?.entries ?? {});
  for (const entry of Object.values(entries)) entry.present_on_printer = false;
  for (const [id, fresh] of Object.entries(current)) {
    const old = entries[id];
    const history = structuredClone(old?.name_history ?? []);
    if (old && Object.keys(old.names).length && encoded([old.names, old.short_name ?? null]) !== encoded([fresh.names, fresh.short_name ?? null])) {
      history.push({ names: old.names, short_name: old.short_name ?? null, observed_at: old.observed_at });
    }
    entries[id] = { ...fresh, id, present_on_printer: true, observed_at: observedAt, source: 'printer_ivec', name_history: history };
  }
  return { version: 1, printer_mac: mac, collected_at: observedAt, ...metadata, entries };
}
export async function collectCatalog(client: Transport, mac: string, cachePath: string): Promise<Catalogue> {
  mac = canonicalMac(mac);
  const previous = existsSync(cachePath) ? catalogueSchema.parse(JSON.parse(readFileSync(cachePath, 'utf8'))) : undefined;
  if (previous && (previous.version !== 1 || previous.printer_mac !== mac)) throw new ProtocolError('Incompatible media cache');
  const [header, metadata] = await readHeader(client);
  const current: Record<string, Names & { visible: boolean }> = {};
  for (const [id, attributes] of Object.entries(header)) current[id] = { ...attributes, ...await readNames(client, id) };
  const after = await readHeader(client);
  if (encoded([header, metadata]) !== encoded(after)) throw new ProtocolError('Printer media catalogue changed during collection; retry');
  const result = mergeCatalog(previous, current, mac, now(), metadata);
  secureWrite(cachePath, JSON.stringify(result, null, 2) + '\n');
  return result;
}
export function resolveMedia(id: string | null, catalogue: Catalogue, language = 'EN'): NonNullable<JobRecord['media']> {
  const entry = id ? catalogue.entries[id] : undefined;
  if (entry) {
    const [name, chosen] = selectName(entry, language);
    if (name) return { id, name, language: chosen, resolution: entry.present_on_printer ? 'printer_current' : 'cached_last_known', source: entry.source ?? 'printer_ivec', observed_at: entry.observed_at ?? null, present_on_printer: entry.present_on_printer };
  }
  return { id, name: null, language: null, resolution: 'unresolved', source: null, observed_at: null, present_on_printer: null };
}
