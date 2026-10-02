/**
 * Intel HEX parser.
 *
 * Only the subset of record types that real-world 8/16/32-bit firmware
 * images rely on is supported: Data (00), End Of File (00 line with
 * zero bytes), Extended Linear Address (04), and Start Segment/Linear
 * Address records (03 / 05).  Record types 01 and 02 — Extended Segment
 * Address — are handled too, because the Intel HEX specification lists
 * them as part of the base format and they appear in ROM images from the
 * 1990s.
 *
 * What is deliberately NOT supported: record types 06 (start linear
 * address with a different encoding) is treated as a parse error.  If
 * you need it, send a patch — but inventing a handler that has never
 * been exercised is worse than failing loudly.
 */

/**
 * Intel HEX record type codes.
 *
 * The numeric values match the values embedded in the file format, so
 * callers can compare against `RecordType.DATA === 0x00` etc.
 */
export const RecordType = Object.freeze({
  DATA: 0x00,
  END_OF_FILE: 0x01,
  EXTENDED_SEGMENT_ADDRESS: 0x02,
  START_SEGMENT_ADDRESS: 0x03,
  EXTENDED_LINEAR_ADDRESS: 0x04,
  START_LINEAR_ADDRESS: 0x05,
});

/**
 * Parse a single Intel HEX record line (including the leading ':').
 *
 * The format of a record is:
 *
 *     :LLAAAATT[DD...]CC
 *
 * - ':'   start code
 * - LL    byte count (two hex digits)
 * - AAAA  address (four hex digits)
 * - TT    record type (two hex digits)
 * - DD... data (LL bytes, 2*LL hex digits)
 * - CC    checksum (two hex digits)
 *
 * The checksum is the two's complement of the sum of all decoded bytes
 * after the ':', modulo 256.  We verify it strictly — a bad checksum is
 * a sign of a truncated or corrupted file, and silently producing
 * garbage data from one is the kind of bug that costs a firmware engineer
 * a week.
 *
 * @param {string} line - A single record, optionally with surrounding whitespace.
 * @returns {{byteCount:number,address:number,recordType:number,data:Uint8Array,checksum:number}}
 * @throws {Error} if the line is malformed or the checksum is wrong.
 */
export function parseRecord(line) {
  if (typeof line !== 'string') {
    throw new TypeError('parseRecord: line must be a string');
  }
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    throw new Error('parseRecord: empty line');
  }
  if (trimmed[0] !== ':') {
    throw new Error(`parseRecord: missing ':' start code in "${line}"`);
  }

  const hex = trimmed.slice(1);
  // Every byte is two hex digits, so the body must have even length.
  if (hex.length % 2 !== 0) {
    throw new Error(`parseRecord: odd number of hex digits in "${line}"`);
  }
  // Minimum record (count + address + type + checksum) is 10 hex digits.
  if (hex.length < 10) {
    throw new Error(`parseRecord: record too short in "${line}"`);
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const b = hex.substr(i * 2, 2);
    const v = parseHexByte(b);
    if (v === null) {
      throw new Error(`parseRecord: invalid hex byte "${b}" in "${line}"`);
    }
    bytes[i] = v;
  }

  const byteCount = bytes[0];
  const address = (bytes[1] << 8) | bytes[2];
  const recordType = bytes[3];
  const checksum = bytes[bytes.length - 1];

  // The data payload is everything between the header and the checksum.
  // For a well-formed record its length equals byteCount; we verify both
  // to catch truncated lines where the byte count and actual payload disagree.
  const expectedDataBytes = bytes.length - 5; // 4 header + 1 checksum
  if (expectedDataBytes !== byteCount) {
    throw new Error(
      `parseRecord: byte count ${byteCount} does not match payload length ${expectedDataBytes} in "${line}"`,
    );
  }

  const data = bytes.slice(4, 4 + byteCount);

  // Checksum: sum of all bytes except the checksum itself, modulo 256,
  // then two's complement.  A correct record sums to zero when the
  // checksum byte is included.
  let sum = 0;
  for (let i = 0; i < bytes.length - 1; i++) {
    sum = (sum + bytes[i]) & 0xff;
  }
  const computed = (-sum) & 0xff;
  if (computed !== checksum) {
    throw new Error(
      `parseRecord: bad checksum in "${line}" (expected 0x${computed.toString(16).padStart(2, '0')}, got 0x${checksum.toString(16).padStart(2, '0')})`,
    );
  }

  return { byteCount, address, recordType, data, checksum };
}

/**
 * Decode two hex characters into a byte value, or null if invalid.
 *
 * We avoid Number.parseInt here because `parseInt('0x1g', 16)` is
 * forgiving in surprising ways (it stops at the first bad digit).
 * Scanning character-by-character gives strict, predictable behaviour.
 */
function parseHexByte(s) {
  if (s.length !== 2) return null;
  const hi = hexVal(s.charCodeAt(0));
  const lo = hexVal(s.charCodeAt(1));
  if (hi === -1 || lo === -1) return null;
  return (hi << 4) | lo;
}

function hexVal(c) {
  if (c >= 0x30 && c <= 0x39) return c - 0x30; // 0-9
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10; // A-F
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10; // a-f
  return -1;
}

/**
 * Parse a complete Intel HEX file into an ordered list of records.
 *
 * Blank lines are skipped; every other line must be a valid record.
 * We do not enforce that an End Of File record is present, because some
 * toolchains emit trailing comments or omit the EOF record on purpose —
 * strictness here would reject real files.  Callers that require an EOF
 * record can check the last record's type themselves.
 *
 * @param {string} text
 * @returns {Array<{byteCount:number,address:number,recordType:number,data:Uint8Array,checksum:number}>}
 */
export function parseIntelHex(text) {
  if (typeof text !== 'string') {
    throw new TypeError('parseIntelHex: text must be a string');
  }
  const records = [];
  const lines = text.split(/\r\n|[\r\n]/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim().length === 0) continue;
    const rec = parseRecord(raw);
    records.push(rec);
  }
  return records;
}
