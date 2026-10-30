/** One PNG-encoded member of an `.icns` file. */
export interface IcnsEntry {
  /** The four-character OSType, e.g. `ic10` for 1024×1024 (512 pt @2x). */
  readonly type: string;
  readonly png: Uint8Array;
}

const headerLength = 8;
const fourPrintableCharacters = /^[ -~]{4}$/u;

/**
 * Packs PNG images into an Apple Icon Image (`.icns`) file: the `icns` magic and total length, then
 * per entry its type, length (header included) and data, all lengths big-endian. The caller picks
 * the types matching each PNG's size; nothing is resized or checked beyond the type's shape.
 */
export function encodeIcns(entries: readonly IcnsEntry[]): Uint8Array {
  const total = entries.reduce((sum, entry) => sum + headerLength + entry.png.length, headerLength);
  const file = Buffer.alloc(total);
  file.write('icns', 0, 'latin1');
  file.writeUInt32BE(total, 4);
  let offset = headerLength;
  for (const { type, png } of entries) {
    if (!fourPrintableCharacters.test(type)) {
      throw new RangeError(`invalid icns type ${JSON.stringify(type)}`);
    }
    file.write(type, offset, 'latin1');
    file.writeUInt32BE(headerLength + png.length, offset + 4);
    file.set(png, offset + headerLength);
    offset += headerLength + png.length;
  }
  return file;
}
