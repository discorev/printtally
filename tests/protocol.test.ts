import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { authCode, decodeRecords, verifyPayload, parseXml, COMMON, CANON, checked, Ivec, canonicalMac, type Transport, readBatch } from 'print-accounting-ivec/protocol';
import { secureWrite } from 'print-accounting-ivec/files';
import { normalized, csvExport, timestamp, scaled } from 'print-accounting-core';
import type { Field } from 'print-accounting-contracts';
const schema: Field[] = [
  { name: 'job_record_number', type: 'uint', order: '1' }, { name: 'job_name', type: 'string', order: '2' },
  { name: 'job_used_ink_C', type: 'uint', order: '3', unit: 'ml', factor: '1000' },
];
const cipher = Buffer.from('6f68a35ea29378ff0881e88ed46c8b6ce88df082ce9c9add9b38bb52d6c2940d', 'hex');
const key = Buffer.from(Array.from({ length: 16 }, (_, i) => i)), iv = Buffer.from(Array.from({ length: 16 }, (_, i) => i + 16));
const prefix = Buffer.alloc(4); prefix.writeUInt32BE(cipher.length);
const payload = Buffer.concat([prefix, cipher]);
const envelope = (content: string): Buffer => Buffer.from(`<cmd xmlns:ivec="${COMMON}" xmlns:vcn="${CANON}">${content}</cmd>`);
test('authentication matches reference vector', () => {
  assert.equal(authCode('test-password', '0123456789abcdef'.repeat(2), 'test-session'), '277e5548adbf3be0de41a2b76d55b98eddd3d50bf7d52a93b6013b5445f17b71');
});
test('AES decrypts the reference fixture and preserves exact quantities', () => {
  const [record] = decodeRecords(payload, key, iv, schema);
  assert.equal(record.job_name, 'A, quoted job');
  assert.deepEqual(normalized(record, schema).ink_ml, { C: '0.125' });
  assert.equal(normalized(record, schema).total_ink_ml, '0.125');
});
test('truncated framing and schema mismatch are rejected', () => {
  for (const value of [payload.subarray(0, -1), Buffer.from([0]), Buffer.alloc(4)]) assert.throws(() => decodeRecords(value, key, iv, schema));
  assert.throws(() => decodeRecords(payload, key, iv, schema.slice(0, -1)));
});
test('checksum detects payload corruption', () => {
  const sum = Buffer.alloc(4); sum.writeUInt32BE(payload.reduce((a, b) => a + b, 0));
  const checksum = createHash('sha256').update(Buffer.concat([sum, Buffer.from('xcnsdata11')])).digest('hex');
  const root = parseXml(envelope(`<ivec:datasize>${payload.length}</ivec:datasize><vcn:ijdatakey6>${checksum}</vcn:ijdatakey6>`));
  verifyPayload(root, payload);
  const bad = Buffer.from(payload); bad[bad.length - 1] ^= 1;
  assert.throws(() => verifyPayload(root, bad));
});
test('session and service mismatch are rejected', () => {
  const body = envelope('<ivec:operation>GetStatusResponse</ivec:operation><ivec:param_set servicetype="joblog"><ivec:response>OK</ivec:response><ivec:job_description>OTHER</ivec:job_description></ivec:param_set>');
  assert.throws(() => checked(body, 'GetStatus', 'EXPECTED'));
  assert.throws(() => checked(body, 'GetStatus', undefined, 'media'));
});
test('write operations and unrelated services never reach the network', async () => {
  const client = new Ivec('127.0.0.1');
  for (const op of ['SetConfiguration', 'SendData', 'Print', 'DeleteJob']) await assert.rejects(client.request(op));
  await assert.rejects(client.request('GetCapability', [], 'firmware' as never));
  client.close();
});
test('atomic export keeps owner-only permissions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'printtally-files-'));
  try {
    const path = join(dir, 'export'); secureWrite(path, 'synthetic export');
    assert.equal(statSync(path).mode & 0o777, 0o600);
    secureWrite(path, 'replacement export'); assert.equal(statSync(path).mode & 0o777, 0o600);
  } finally { rmSync(dir, { recursive: true }); }
});
test('CSV formula protection leaves raw data unchanged', () => {
  const record = normalized({ job_record_number: 7, job_name: '=1+1', job_used_ink_C: 125 }, schema);
  assert.match(csvExport([record], schema), /'=1\+1/); assert.equal(record.raw.job_name, '=1+1');
});
test('MAC padding and invalid MAC rejection', () => {
  assert.equal(canonicalMac('2:0:0:0:0:1'), '020000000001'); assert.throws(() => canonicalMac('../invalid'));
});
test('timestamps retain microseconds and normalize offsets', () => {
  assert.equal(timestamp('2026-09-01T13:00:00.123456+01:00'), '2026-09-01T12:00:00.123456+00:00');
  assert.throws(() => timestamp('2026-09-01T12:00:00'));
});
test('exact integer scaling rejects rounding and unsupported factors', () => {
  const field: Field = { name: 'ink', type: 'uint', unit: 'ml', factor: '3' };
  assert.throws(() => scaled({ ink: 1 }, new Map([['ink', field]]), 'ink', 'ml', 1000000n));
  assert.equal(normalized({ job_record_number: 1, job_name: 'unknown', job_used_ink_C: null }, schema).total_ink_ml, null);
});
test('malformed XML and entities are rejected without echoing data', () => {
  for (const text of ['<!DOCTYPE x [<!ENTITY a "secret">]><x/>', '<cmd><bad></cmd>']) assert.throws(() => parseXml(Buffer.from(text)));
});
test('job resource closes on decryption-context failure', async () => {
  const operations: string[] = [];
  let description = '';
  const client: Transport = { async request(operation, params = []) {
    operations.push(operation);
    description = params.find(([key]) => key === 'ivec:job_description')?.[1] ?? description;
    const challenge = params.some(([key]) => key === 'vcn:ijdatakey3');
    return envelope(`<ivec:operation>${operation}Response</ivec:operation><ivec:param_set servicetype="joblog"><ivec:response>OK</ivec:response><ivec:job_description>${description}</ivec:job_description><ivec:jobID>00000001</ivec:jobID>${challenge ? '<vcn:ijdatakey4>' + '01'.repeat(32) + '</vcn:ijdatakey4>' : ''}</ivec:param_set>`);
  } };
  await assert.rejects(readBatch(client, 'dummy', '020000000001', 1, 1, schema));
  assert.deepEqual(operations, ['StartResource', 'StartResource', 'EndResource']);
});
