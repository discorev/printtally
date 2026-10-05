import { isIPv4, type Socket } from 'node:net';
import { checkServerIdentity, connect as connectTls, type ConnectionOptions, type TLSSocket } from 'node:tls';
import { createHash, createDecipheriv, randomUUID, timingSafeEqual, X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DOMParser } from '@xmldom/xmldom';
import { parse } from 'csv-parse/sync';
import type { Field, RawRecord } from 'print-accounting-contracts';
import authTables from './auth-tables.json' with { type: 'json' };

export const COMMON = 'http://www.canon.com/ns/cmd/2008/07/common/';
export const CANON = 'http://www.canon.com/ns/cmd/2008/07/canon/';
// A static import, so `bun build --compile` embeds the tables in the binary.
const tables: Record<string, string> = authTables;
const hash = (data: string | Buffer): Buffer => createHash('sha256').update(data).digest();
export class ProtocolError extends Error {}
export type Xml = Document | Element;
export type Params = [string, string][];
export type Service = 'joblog' | 'media' | 'print' | 'device';
const RESOURCE_READS = ['GetCapability', 'GetStatus', 'StartResource', 'ReceiveData', 'EndResource'];
const READ_ONLY: Record<Service, readonly string[]> = {
  joblog: RESOURCE_READS, media: RESOURCE_READS,
  print: ['GetStatus'], device: ['GetStatus', 'GetCapability'],
};
export interface Transport {
  request(operation: string, params?: Params, service?: Service): Promise<Buffer>;
}
export function parseXml(data: Buffer): Document {
  if (data.length > 8 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(data.toString('utf8'))) throw new ProtocolError('Unsupported XML');
  const source = new TextDecoder('utf-8', { fatal: true }).decode(data);
  return new DOMParser({ errorHandler: {
    warning: () => { throw new ProtocolError('Malformed XML'); },
    error: () => { throw new ProtocolError('Malformed XML'); },
    fatalError: () => { throw new ProtocolError('Malformed XML'); },
  }}).parseFromString(source, 'text/xml');
}
export function elements(root: Xml, name: string): Element[] {
  const [prefix, local] = name.split(':');
  if (!local || !['ivec', 'vcn'].includes(prefix)) throw new ProtocolError('Unknown XML namespace');
  return Array.from(root.getElementsByTagNameNS(prefix === 'ivec' ? COMMON : CANON, local));
}
export const value = (root: Xml, name: string): string | null => elements(root, name)[0]?.textContent ?? null;
export function xmlPart(body: Buffer): [Document, Buffer] {
  const end = body.indexOf('</cmd>');
  if (end < 0) throw new ProtocolError('Missing IVEC XML envelope');
  return [parseXml(body.subarray(0, end + 6)), body.subarray(end + 6)];
}
export function checked(body: Buffer, operation: string, description?: string, service: Service = 'joblog'): [Document, Buffer] {
  const [root, payload] = xmlPart(body);
  if (value(root, 'ivec:operation') !== operation + 'Response') throw new ProtocolError('Unexpected IVEC operation');
  if (elements(root, 'ivec:param_set')[0]?.getAttribute('servicetype') !== service) throw new ProtocolError('Unexpected IVEC service');
  if (description && value(root, 'ivec:job_description') !== description) throw new ProtocolError('IVEC session mismatch');
  if (value(root, 'ivec:response') !== 'OK') {
    const detail = value(root, 'ivec:response_detail') ?? '';
    throw new ProtocolError(operation + ' failed: ' + (['AuthenticationError', 'ParameterError', 'Busy', 'NotSupported'].includes(detail) ? detail : 'printer rejected request'));
  }
  return [root, payload];
}
export function authCode(password: string, challenge: string, description: string, protocol = 0x20003): string {
  const rules = Buffer.from(tables.rules, 'hex'), shuffle = Buffer.from(tables.shuffle, 'hex'), salts = Buffer.from(tables.salts, 'hex');
  function mix(index: number, input: Buffer, extraChallenge?: string, strings: string[] = []): Buffer {
    const rule = rules.subarray(index * 10, (index + 1) * 10);
    let data = input;
    for (let round = 0; round < rule[1]; round++) {
      const order = shuffle.subarray(rule[2 + round] * 32, (rule[2 + round] + 1) * 32);
      data = Buffer.from([...order].filter(index => index < data.length).map(index => data[index]));
      if (round === 0) data = Buffer.concat([data, ...(extraChallenge ? [Buffer.from(extraChallenge, 'hex')] : []), ...strings.map(text => Buffer.from(text, 'utf8'))]);
      const salt = data[rule[0]] & 31;
      data = hash(Buffer.concat([data, salts.subarray(salt * 32, (salt + 1) * 32)]));
    }
    return data;
  }
  const digest = hash(password), derived = mix(0, digest);
  return mix(protocol & 15, (protocol | 2) === 0x20006 ? digest : derived, challenge, ['xcnsdata1', description, 'ADMIN']).toString('hex');
}

// CHMP runs inside a verified TLS connection. Its POST acknowledgement can deliberately omit body framing. General fetch
// clients treat that as an EOF-delimited response and wait forever. Keep explicit
// control of one TCP socket for the POST/GET pair and reject unframed GET bodies.
class Reader {
  socket: Socket;
  buffer: Buffer = Buffer.alloc(0);
  error?: Error;
  wake?: () => void;
  constructor(socket: Socket) {
    this.socket = socket;
    socket.on('data', data => {
      this.buffer = Buffer.concat([this.buffer, data]);
      if (this.buffer.length > 9 * 1024 * 1024) socket.destroy(new ProtocolError('IVEC response too large'));
      this.wake?.();
    });
    socket.on('error', () => { this.error = new ProtocolError('Printer connection failed'); this.wake?.(); });
    socket.on('close', () => { this.error ??= new ProtocolError('Printer connection closed'); this.wake?.(); });
    socket.on('timeout', () => socket.destroy(new ProtocolError('Printer request timed out')));
  }
  async more(): Promise<void> {
    if (this.error) throw this.error;
    await new Promise<void>(resolve => { this.wake = resolve; });
    this.wake = undefined;
    if (this.error && !this.buffer.length) throw this.error;
  }
  async bytes(size: number): Promise<Buffer> {
    while (this.buffer.length < size) await this.more();
    const result = this.buffer.subarray(0, size);
    this.buffer = this.buffer.subarray(size);
    return result;
  }
  async line(): Promise<string> {
    while (this.buffer.indexOf('\r\n') < 0) {
      if (this.buffer.length > 16384) throw new ProtocolError('Oversized HTTP line');
      await this.more();
    }
    const size = this.buffer.indexOf('\r\n');
    if (size > 16384) throw new ProtocolError('Oversized HTTP line');
    return (await this.bytes(size + 2)).subarray(0, size).toString('ascii');
  }
  async response(ack: boolean): Promise<Buffer> {
    if (!/^HTTP\/1\.[01] 200(?: |$)/.test(await this.line())) throw new ProtocolError('Unexpected IVEC HTTP status');
    const headers = new Map<string, string>();
    let totalHeader = 0;
    for (;;) {
      const line = await this.line();
      if (!line) break;
      totalHeader += line.length;
      if (totalHeader > 65536) throw new ProtocolError('Oversized HTTP headers');
      const colon = line.indexOf(':');
      if (colon < 1) throw new ProtocolError('Invalid HTTP header');
      const key = line.slice(0, colon).toLowerCase(), text = line.slice(colon + 1).trim();
      if (headers.has(key)) throw new ProtocolError('Duplicate HTTP header');
      headers.set(key, text);
    }
    const transfer = headers.get('transfer-encoding'), length = headers.get('content-length');
    if (transfer && length) throw new ProtocolError('Ambiguous HTTP framing');
    const max = 8 * 1024 * 1024;
    if (transfer) {
      if (transfer.toLowerCase() !== 'chunked') throw new ProtocolError('Unsupported transfer encoding');
      const chunks: Buffer[] = [];
      let total = 0;
      for (;;) {
        const line = await this.line();
        if (!/^[0-9a-fA-F]+(?:;.*)?$/.test(line)) throw new ProtocolError('Invalid chunk size');
        const size = parseInt(line.split(';')[0], 16);
        if (!Number.isSafeInteger(size) || total + size > max) throw new ProtocolError('IVEC response too large');
        if (size === 0) {
          let trailers = 0;
          while (await this.line()) if (++trailers > 100) throw new ProtocolError('Too many HTTP trailers');
          return Buffer.concat(chunks);
        }
        chunks.push(await this.bytes(size)); total += size;
        if ((await this.bytes(2)).toString() !== '\r\n') throw new ProtocolError('Invalid chunk terminator');
      }
    }
    if (length !== undefined) {
      if (!/^\d+$/.test(length) || Number(length) > max) throw new ProtocolError('Invalid HTTP content length');
      return this.bytes(Number(length));
    }
    if (ack) return Buffer.alloc(0);
    throw new ProtocolError('Unframed IVEC response');
  }
}
const escapeXml = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
// Bun's node:tls can emit secureConnect with authorized=true after a failed or
// plaintext handshake, ignores minVersion above its floor and skips the address
// check. Check the peer here too, before the first application byte.
function verifiedPeer(socket: TLSSocket, host: string): boolean {
  if (!socket.authorized || socket.destroyed || !['TLSv1.2', 'TLSv1.3'].includes(socket.getProtocol() ?? '')) return false;
  try {
    const certificate = socket.getPeerCertificate();
    return !!certificate?.raw && checkServerIdentity(host, certificate) === undefined;
  } catch { return false; }
}
export interface IvecConnectionOptions {
  timeoutMs?: number;
  port?: number;
  trustedCertificatePem?: string;
}
export class Ivec implements Transport {
  host: string;
  timeout: number;
  private reader?: Reader;
  private endpoint?: string;
  private busy = false;
  private port: number;
  private tlsOptions: ConnectionOptions;
  constructor(host: string, options: IvecConnectionOptions = {}) {
    const timeout = options.timeoutMs ?? 20000;
    const port = options.port ?? 443;
    if (!isIPv4(host)) throw new ProtocolError('Expected printer IPv4 address');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ProtocolError('Invalid printer port');
    if (!Number.isSafeInteger(timeout) || timeout < 1) throw new ProtocolError('Invalid connection timeout');
    this.host = host; this.timeout = timeout; this.port = port;
    // The printer picks its certificate by SNI. Without the IP as server name, Bun is
    // served the DNS-name (.local) certificate and the IP identity check rightly fails.
    this.tlsOptions = { rejectUnauthorized: true, minVersion: 'TLSv1.2', servername: host };
    if (options.trustedCertificatePem !== undefined) {
      // Trust the printer's root, so leaf renewal does not require re-enrolment.
      // The chain, validity and destination address are still validated.
      // Supplying ca replaces the default roots for this connection only.
      const pem = options.trustedCertificatePem;
      if ((pem.match(/-----BEGIN CERTIFICATE-----/g) ?? []).length !== 1) throw new ProtocolError('Expected one trusted printer root certificate');
      let root: X509Certificate;
      try { root = new X509Certificate(pem); }
      catch { throw new ProtocolError('Invalid printer root certificate'); }
      if (!root.ca || root.subject !== root.issuer || !root.verify(root.publicKey)) throw new ProtocolError('Expected a self-signed printer root CA certificate');
      this.tlsOptions = { ...this.tlsOptions, ca: pem };
    }
  }
  close(): void { this.reader?.socket.destroy(); this.reader = undefined; this.endpoint = undefined; }
  async request(operation: string, params: Params = [], service: Service = 'joblog'): Promise<Buffer> {
    if (!READ_ONLY[service]?.includes(operation)) throw new ProtocolError('Request outside read-only allowlist');
    if (this.busy) throw new ProtocolError('Concurrent IVEC requests are unsupported');
    this.busy = true;
    try {
      const endpoint = '/canon/ij/command2/port' + (['GetCapability', 'GetStatus'].includes(operation) ? '1' : '2');
      if (endpoint !== this.endpoint || this.reader?.socket.destroyed) this.close();
      if (!this.reader) {
        const socket = connectTls({ host: this.host, port: this.port, ...this.tlsOptions });
        socket.setTimeout(this.timeout);
        this.reader = new Reader(socket); this.endpoint = endpoint;
        // Do not queue even unauthenticated IVEC bytes until TLS has authenticated
        // the peer. There is no HTTP downgrade or accept-any-certificate path.
        await new Promise<void>((resolve, reject) => {
          const settle = (verified: boolean): void => {
            socket.off('secureConnect', ready); socket.off('error', failed); socket.off('close', failed);
            if (verified) { resolve(); return; }
            socket.destroy(); reject(new ProtocolError('Verified TLS connection failed; check connectivity and printer certificate trust'));
          };
          const failed = (): void => settle(false);
          const ready = (): void => settle(verifiedPeer(socket, this.host));
          socket.once('secureConnect', ready); socket.once('error', failed); socket.once('close', failed);
        });
      }
      // Match Canon's own formatting (explicit closing tags, uppercase UUID in CDATA).
      // Earlier requests without it failed; which detail the printer needs was never isolated.
      const content = params.map(([name, text]) => {
        if (!/^(ivec|vcn):[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) throw new ProtocolError('Invalid XML parameter');
        const value = name === 'ivec:job_description' && /^[A-Za-z0-9-]+$/.test(text) ? '<![CDATA[' + text + ']]>' : escapeXml(text);
        return '<' + name + '>' + value + '</' + name + '>';
      }).join('');
      const xml = Buffer.from('<?xml version="1.0" encoding="utf-8"?>\n<cmd xmlns:ivec="' + COMMON + '" xmlns:vcn="' + CANON + '"><ivec:contents><ivec:operation>' + operation + '</ivec:operation><ivec:param_set servicetype="' + service + '">' + content + '</ivec:param_set></ivec:contents></cmd>');
      const base = ' HTTP/1.1\r\nHost: ' + this.host + '\r\nX-CHMP-Version: 1.3.0\r\n';
      this.reader.socket.write(Buffer.concat([Buffer.from('POST ' + endpoint + base + 'Content-Type: application/octet-stream\r\nContent-Length: ' + xml.length + '\r\n\r\n'), xml]));
      await this.reader.response(true);
      this.reader.socket.write('GET ' + endpoint + base + 'X-CHMP-Timeout: 5\r\n\r\n');
      return await this.reader.response(false);
    } catch (error) { this.close(); throw error; }
    finally { this.busy = false; }
  }
}
export function canonicalMac(address: string): string {
  const parts = address.split(':');
  if (parts.length === 6 && parts.every(part => /^[0-9a-fA-F]{1,2}$/.test(part))) return parts.map(part => part.padStart(2, '0')).join('').toLowerCase();
  if (/^[0-9a-fA-F]{12}$/.test(address)) return address.toLowerCase();
  throw new ProtocolError('Expected the printer six-byte MAC address');
}
export function resolveMac(host: string): string {
  // Discovery is optional and platform-specific; explicit --mac works across routers/OSes.
  if (process.platform !== 'darwin') throw new ProtocolError('Pass --mac on this platform');
  const output = execFileSync('/usr/sbin/arp', ['-n', host], { encoding: 'utf8', timeout: 5000 });
  const match = / at ([0-9a-fA-F:]+) on /.exec(output);
  if (!match) throw new ProtocolError('Printer MAC unavailable; pass --mac explicitly');
  return canonicalMac(match[1]);
}
export async function authenticated(client: Transport, operation: string, password: string, extra: Params = []): Promise<[Document, string]> {
  const description = randomUUID().toUpperCase();
  const base: Params = [['ivec:job_description', description], ...extra];
  const [root, payload] = xmlPart(await client.request(operation, [...base, ['vcn:ijdatakey3', '3bac56b1a987e0a676325f5495dd50f7']]));
  if (value(root, 'ivec:operation') !== operation + 'Response' || value(root, 'ivec:job_description') !== description || elements(root, 'ivec:param_set')[0]?.getAttribute('servicetype') !== 'joblog') throw new ProtocolError('Invalid authentication challenge response');
  // The first reply is response=NG carrying the challenge; that is the normal first
  // step, not a rejected password, so it is read before checked() is applied.
  const challenge = value(root, 'vcn:ijdatakey4');
  if (payload.length || !challenge || !/^[0-9a-f]{64}$/.test(challenge)) throw new ProtocolError('Missing or unsupported authentication challenge');
  const [result, data] = checked(await client.request(operation, [...base, ['vcn:ijdatakey1', 'ADMIN'], ['vcn:ijdatakey2', authCode(password, challenge, description)]]), operation, description);
  if (data.length) throw new ProtocolError('Unexpected authentication payload');
  return [result, description];
}
function equalHex(actual: string | null, expected: string): boolean {
  return !!actual && /^[0-9a-f]{64}$/.test(actual) && timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
export function encryptionContext(start: Xml, mac: string): [Buffer, Buffer] {
  const key7 = value(start, 'vcn:ijdatakey7');
  if (!key7 || !/^[0-9a-f]{16}$/.test(key7)) throw new ProtocolError('Unsupported encryption parameters');
  const signed = (value(start, 'ivec:job_description') ?? '') + (value(start, 'ivec:jobID') ?? '') + key7 + tables.crypt_suffix;
  if (!equalHex(value(start, 'vcn:ijdatakey8'), hash(signed).toString('hex'))) throw new ProtocolError('Encryption parameter integrity check failed');
  const algorithm = parseInt(key7.slice(0, 8), 16), index = parseInt(key7.slice(8), 16);
  // Only algorithm 4 has been observed; other values may be valid on other models/firmware.
  if (algorithm !== 4 || index >= 16) throw new ProtocolError('Unsupported IVEC encryption variant');
  const rules = Buffer.from(tables.crypt_rules, 'hex');
  const saltIndex = rules.readUInt32LE(index * 8), ivIndex = rules.readUInt32LE(index * 8 + 4);
  const salt = Buffer.from(tables.crypt_salts, 'hex').subarray(saltIndex * 16, (saltIndex + 1) * 16);
  const iv = Buffer.from(tables.crypt_ivs, 'hex').subarray(ivIndex * 16, (ivIndex + 1) * 16);
  if (salt.length !== 16 || iv.length !== 16) throw new ProtocolError('Invalid encryption table');
  return [hash(Buffer.concat([hash(canonicalMac(mac)), salt])).subarray(-16), iv];
}
export function verifyPayload(root: Xml, payload: Buffer): void {
  if (String(payload.length) !== value(root, 'ivec:datasize')) throw new ProtocolError('IVEC payload length mismatch');
  const sum = Buffer.alloc(4); sum.writeUInt32BE(payload.reduce((sum, byte) => (sum + byte) >>> 0, 0));
  if (!equalHex(value(root, 'vcn:ijdatakey6'), hash(Buffer.concat([sum, Buffer.from('xcnsdata11')])).toString('hex'))) throw new ProtocolError('IVEC payload checksum mismatch');
}
export function decodeRecords(payload: Buffer, key: Buffer, iv: Buffer, schema: Field[]): RawRecord[] {
  const records: RawRecord[] = [];
  let offset = 0;
  while (offset < payload.length) {
    if (payload.length - offset < 4) throw new ProtocolError('Truncated record length');
    const size = payload.readUInt32BE(offset); offset += 4;
    if (!size || size % 16 || offset + size > payload.length) throw new ProtocolError('Truncated encrypted record');
    let plain: Buffer;
    try {
      const decipher = createDecipheriv('aes-128-cbc', key, iv);
      plain = Buffer.concat([decipher.update(payload.subarray(offset, offset + size)), decipher.final()]);
    } catch { throw new ProtocolError('Record decryption failed; check printer MAC address'); }
    offset += size;
    const rows = parse(new TextDecoder('utf-8', { fatal: true }).decode(plain)) as string[][];
    if (rows.length !== 1 || rows[0].length !== schema.length) throw new ProtocolError('Job record does not match advertised schema');
    const record: RawRecord = {};
    schema.forEach((field, index) => {
      const text = rows[0][index];
      if (field.type === 'uint') {
        if (text && (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)))) throw new ProtocolError('Invalid unsigned job value');
        record[field.name] = text ? Number(text) : null;
      } else if (field.type === 'string') record[field.name] = text;
      else throw new ProtocolError('Unsupported schema field type');
    });
    records.push(record);
  }
  return records;
}
export async function readBatch(client: Transport, password: string, mac: string, first: number, last: number, schema: Field[]): Promise<RawRecord[]> {
  const [start, description] = await authenticated(client, 'StartResource', password, [['ivec:bidi', '1']]);
  const jobId = value(start, 'ivec:jobID');
  if (!jobId || !/^[0-9A-Fa-f]{8}$/.test(jobId)) throw new ProtocolError('Missing resource identifier');
  const session: Params = [['ivec:jobID', jobId], ['ivec:job_description', description]];
  let failed = false;
  try {
    const [key, iv] = encryptionContext(start, mac);
    const [root, payload] = checked(await client.request('ReceiveData', [...session, ['ivec:format', 'PrintJobLog'], ['ivec:joblog_range', first + ':' + last]]), 'ReceiveData', description);
    if (value(root, 'ivec:jobID') !== jobId || value(root, 'ivec:format') !== 'PrintJobLog') throw new ProtocolError('Resource response mismatch');
    // Batches of up to 20 records have only ever returned continue=OFF; multipart is unexplored.
    if (value(root, 'ivec:continue') !== 'OFF') throw new ProtocolError('Multipart transfer unsupported; reduce batch size');
    verifyPayload(root, payload);
    return decodeRecords(payload, key, iv, schema);
  } catch (error) { failed = true; throw error; }
  finally { try { checked(await client.request('EndResource', session), 'EndResource', description); } catch (error) { if (!failed) throw error; } }
}
