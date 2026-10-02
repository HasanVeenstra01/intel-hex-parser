import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRecord, parseIntelHex, RecordType } from '../src/core.js';

function buildRecord(byteCount, address, type, dataBytes) {
  const body = [byteCount, (address >> 8) & 0xff, address & 0xff, type, ...dataBytes];
  let sum = 0;
  for (const b of body) sum = (sum + b) & 0xff;
  const checksum = (-sum) & 0xff;
  const hex = body.map((b) => b.toString(16).padStart(2, '0')).join('') + checksum.toString(16).padStart(2, '0');
  return ':' + hex.toUpperCase();
}

test('parseRecord: parses a data record', () => {
  const line = buildRecord(4, 0x0000, RecordType.DATA, [0x00, 0x01, 0x02, 0x03]);
  const r = parseRecord(line);
  assert.equal(r.byteCount, 4);
  assert.equal(r.address, 0x0000);
  assert.equal(r.recordType, RecordType.DATA);
  assert.deepEqual(Array.from(r.data), [0x00, 0x01, 0x02, 0x03]);
});

test('parseRecord: parses an end-of-file record', () => {
  const line = ':00000001FF';
  const r = parseRecord(line);
  assert.equal(r.byteCount, 0);
  assert.equal(r.address, 0x0000);
  assert.equal(r.recordType, RecordType.END_OF_FILE);
  assert.equal(r.data.length, 0);
});

test('parseRecord: parses an extended linear address record', () => {
  const line = buildRecord(2, 0x0000, RecordType.EXTENDED_LINEAR_ADDRESS, [0x10, 0x00]);
  const r = parseRecord(line);
  assert.equal(r.recordType, RecordType.EXTENDED_LINEAR_ADDRESS);
  assert.deepEqual(Array.from(r.data), [0x10, 0x00]);
});

test('parseRecord: parses an extended segment address record', () => {
  const line = buildRecord(2, 0x0000, RecordType.EXTENDED_SEGMENT_ADDRESS, [0x00, 0x20]);
  const r = parseRecord(line);
  assert.equal(r.recordType, RecordType.EXTENDED_SEGMENT_ADDRESS);
  assert.deepEqual(Array.from(r.data), [0x00, 0x20]);
});

test('parseRecord: accepts lowercase hex', () => {
  const r = parseRecord(':04000000aabbccdd' + checksumHex([0x04, 0x00, 0x00, 0x00, 0xaa, 0xbb, 0xcc, 0xdd]));
  assert.deepEqual(Array.from(r.data), [0xaa, 0xbb, 0xcc, 0xdd]);
});

function checksumHex(body) {
  let sum = 0;
  for (const b of body) sum = (sum + b) & 0xff;
  return ((-sum) & 0xff).toString(16).padStart(2, '0');
}

test('parseRecord: trims surrounding whitespace', () => {
  const line = '  :00000001FF  ';
  const r = parseRecord(line);
  assert.equal(r.recordType, RecordType.END_OF_FILE);
});

test('parseRecord: rejects a line without a colon', () => {
  assert.throws(() => parseRecord('00000001FF'), /missing ':'/);
});

test('parseRecord: rejects an empty line', () => {
  assert.throws(() => parseRecord(''), /empty line/);
});

test('parseRecord: rejects odd-length hex', () => {
  assert.throws(() => parseRecord(':0000000'), /odd number of hex digits/);
});

test('parseRecord: rejects a bad checksum', () => {
  // Correct checksum for this body would be 0xDD; we force 0x00.
  assert.throws(() => parseRecord(':040000000001020300'), /bad checksum/);
});

test('parseRecord: rejects a byte count that disagrees with the payload', () => {
  // Claims 4 bytes of data but only provides 3.
  const body = [0x04, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03];
  let sum = 0;
  for (const b of body) sum = (sum + b) & 0xff;
  const cksum = ((-sum) & 0xff).toString(16).padStart(2, '0');
  assert.throws(() => parseRecord(':' + body.map((b) => b.toString(16).padStart(2, '0')).join('') + cksum), /byte count .* does not match payload length/);
});

test('parseRecord: rejects non-hex characters', () => {
  assert.throws(() => parseRecord(':0G000000FF'), /invalid hex byte/);
});

test('parseRecord: returns a Uint8Array for data', () => {
  const r = parseRecord(buildRecord(2, 0x1000, RecordType.DATA, [0xde, 0xad]));
  assert.ok(r.data instanceof Uint8Array);
});

test('parseIntelHex: parses multiple records and skips blank lines', () => {
  const text = [
    buildRecord(2, 0x0000, RecordType.DATA, [0x01, 0x02]),
    '',
    '  ',
    buildRecord(0, 0x0000, RecordType.END_OF_FILE, []),
    '',
  ].join('\n');
  const recs = parseIntelHex(text);
  assert.equal(recs.length, 2);
  assert.equal(recs[0].recordType, RecordType.DATA);
  assert.equal(recs[1].recordType, RecordType.END_OF_FILE);
});

test('parseIntelHex: handles CRLF line endings', () => {
  const text = buildRecord(1, 0x0000, RecordType.DATA, [0xff]) + '\r\n' + ':00000001FF';
  const recs = parseIntelHex(text);
  assert.equal(recs.length, 2);
});

test('parseIntelHex: rejects non-string input', () => {
  assert.throws(() => parseIntelHex(42), TypeError);
});

test('parseIntelHex: propagates parse errors with context', () => {
  const text = ':00000001FF\n:not-a-record\n';
  assert.throws(() => parseIntelHex(text), /missing ':'|invalid hex byte|odd number of hex digits/);
});

test('parseRecord: rejects a record shorter than the minimum', () => {
  // Only 8 hex digits after ':' — no room for a checksum.
  assert.throws(() => parseRecord(':00000000'), /record too short/);
});

test('parseRecord: handles a full 255-byte data record', () => {
  const payload = new Array(255);
  for (let i = 0; i < 255; i++) payload[i] = i & 0xff;
  const line = buildRecord(255, 0x8000, RecordType.DATA, payload);
  const r = parseRecord(line);
  assert.equal(r.byteCount, 255);
  assert.deepEqual(Array.from(r.data), payload);
});
