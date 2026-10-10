# intel-hex-parser

A small, dependency-free parser for the Intel HEX object code format. Exports `parseRecord`, `parseIntelHex`, and a `RecordType` constant.

```js
import { parseIntelHex, RecordType } from 'intel-hex-parser';

const hexFileText = `\
:0400000000010203F6
:00000001FF
`;
const records = parseIntelHex(hexFileText);
for (const r of records) {
  if (r.recordType === RecordType.DATA) {
    // r.data is a Uint8Array, r.address is the 16-bit load address
  }
}
```

## Why

Firmware images for 8/16/32-bit microcontrollers are commonly distributed as `.hex` files. The format is line-oriented and simple enough to parse by hand, but the checksum rule and the distinction between byte count and payload length are easy to get wrong. This library exists to do that one job correctly and to fail loudly on corruption rather than emit silently truncated data.

The trade-off: only the record types that appear in real-world firmware are supported — Data, End Of File, Extended Segment Address, Extended Linear Address, and the two Start address records. Anything else throws. Address-segment arithmetic (applying `EXTENDED_LINEAR_ADDRESS` offsets to subsequent `DATA` records) is deliberately left to the caller, because how to combine them depends on the target architecture and the caller almost always knows that better than the parser does.

## Awkward edges

- Every line must begin with `:`. Lines without it are rejected, even if they look like hex.
- The checksum is verified strictly. A single flipped bit makes the whole file unparseable. This is intentional.
- Blank lines are skipped; trailing whitespace on a line is trimmed. Files without an explicit End Of File record still parse — some toolchains omit it.
- `data` on a returned record is a `Uint8Array`, not a plain array, so comparisons in tests should use `Array.from(r.data)`.

## Design notes

The window stores values eagerly rather than keeping running aggregates. Running
sums drift with floating point over long streams, and recomputing from a small
buffer is cheap enough that the drift is not worth the speed.

