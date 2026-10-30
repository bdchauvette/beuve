import { inflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { encodePng } from './encode-png.ts';

describe('encodePng', () => {
  it('writes the signature, an RGBA header and unfiltered rows', () => {
    const pixels = Uint8Array.of(255, 0, 0, 255, 0, 255, 0, 128);
    const png = Buffer.from(encodePng({ width: 2, height: 1, pixels }));

    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.toString('latin1', 12, 16)).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(2);
    expect(png.readUInt32BE(20)).toBe(1);
    expect([...png.subarray(24, 29)]).toEqual([8, 6, 0, 0, 0]);
    const idatLength = png.readUInt32BE(33);
    expect(png.toString('latin1', 37, 41)).toBe('IDAT');
    const rows = inflateSync(png.subarray(41, 41 + idatLength));
    expect([...rows]).toEqual([0, ...pixels]);
    expect(png.toString('latin1', png.length - 8, png.length - 4)).toBe('IEND');
  });

  it('checksums each chunk over its type and data', () => {
    const png = Buffer.from(encodePng({ width: 1, height: 1, pixels: new Uint8Array(4) }));

    expect(png.readUInt32BE(29)).toBe(0x1f_15_c4_89);
    expect(png.readUInt32BE(png.length - 4)).toBe(0xae_42_60_82);
  });

  it('refuses pixels that do not match the size', () => {
    expect(() => encodePng({ width: 2, height: 2, pixels: new Uint8Array(4) })).toThrow(RangeError);
    expect(() => encodePng({ width: 0, height: 1, pixels: new Uint8Array(0) })).toThrow(RangeError);
  });
});
