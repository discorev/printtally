import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNames, selectName, mergeCatalog, resolveMedia, readNames } from 'print-accounting-ivec/media';
import { sample, MEDIA, T1 } from './fixtures.ts';
const xml = Buffer.from('<medianame><medianame_item language="EN"><![CDATA[FineArt Pearl]]></medianame_item><medianame_item language="DE">Papier</medianame_item></medianame>');
test('media CDATA and language fallback', () => {
  const names = parseNames(xml);
  assert.deepEqual(selectName(names, 'DE'), ['Papier', 'DE']);
  assert.deepEqual(selectName(names, 'FR'), ['FineArt Pearl', 'EN']);
  assert.deepEqual(selectName({ names: {}, short_name: 'Short' }), ['Short', null]);
});
test('conflicting names, empty XML, foreign root and entities are rejected', () => {
  for (const text of ['<medianame><medianame_item language="EN">A</medianame_item><medianame_item language="EN">B</medianame_item></medianame>', '<medianame/>', '<other/>', '<!DOCTYPE medianame [<!ENTITY x "bad">]><medianame/>']) assert.throws(() => parseNames(Buffer.from(text)));
});
test('renames preserve identity, history and input catalogue', () => {
  const old = sample().media_catalogue!, original = structuredClone(old);
  const updated = mergeCatalog(old, { [MEDIA]: { names: { EN: 'Renamed' }, short_name: null, visible: true, checksum: 'new' } }, old.printer_mac, T1, {});
  assert.deepEqual(old, original);
  assert.equal(resolveMedia(MEDIA, updated).name, 'Renamed');
  assert.equal(updated.entries[MEDIA].name_history![0].names.EN, 'Configured stock');
  assert.equal(resolveMedia(MEDIA, updated).id, MEDIA);
});
test('removed media keeps explicitly last-known name', () => {
  const old = sample().media_catalogue!;
  const updated = mergeCatalog(old, {}, old.printer_mac, T1, {});
  assert.equal(resolveMedia(MEDIA, updated).resolution, 'cached_last_known');
  assert.equal(resolveMedia(MEDIA, updated).present_on_printer, false);
});
test('cross-printer cache rejected and unknown ID remains unknown', () => {
  const cat = sample().media_catalogue!;
  assert.throws(() => mergeCatalog(cat, {}, '000000000000', T1, {}));
  assert.equal(resolveMedia('unknown', cat).name, null);
  assert.equal(resolveMedia('unknown', cat).resolution, 'unresolved');
});
test('invalid media IDs rejected before network access', async () => {
  await assert.rejects(readNames({ request: async () => { assert.fail('Unexpected network access'); } }, '../invalid'));
});
