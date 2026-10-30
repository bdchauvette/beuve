import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { encodeIcns } from './encode-icns.ts';

describe('encodeIcns', () => {
  test('frames each entry with its type and length after the file header', ({ expect }) => {
    const icns = Buffer.from(
      encodeIcns([
        { type: 'ic07', png: Uint8Array.of(1, 2, 3) },
        { type: 'ic10', png: Uint8Array.of(4) },
      ]),
    );

    expect(icns.toString('latin1', 0, 4)).toBe('icns');
    expect(icns.readUInt32BE(4)).toBe(icns.length);
    expect(icns).toHaveLength(8 + 11 + 9);
    expect(icns.toString('latin1', 8, 12)).toBe('ic07');
    expect(icns.readUInt32BE(12)).toBe(11);
    expect([...icns.subarray(16, 19)]).toStrictEqual([1, 2, 3]);
    expect(icns.toString('latin1', 19, 23)).toBe('ic10');
    expect(icns.readUInt32BE(23)).toBe(9);
    expect(icns[27]).toBe(4);
  });

  test('refuses a type that is not four printable characters', ({ expect }) => {
    expect(() => encodeIcns([{ type: 'ic1', png: new Uint8Array(0) }])).toThrow(RangeError);
  });
});
