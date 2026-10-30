import { crc32, deflateSync } from 'node:zlib';

/** Straight (non-premultiplied) 8-bit RGBA pixels, row by row from the top left. */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  /** `width * height * 4` bytes. */
  readonly pixels: Uint8Array;
}

const signature = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const bitDepth = 8;
const rgbaColorType = 6;

/**
 * Encodes an image as a PNG: 8-bit RGBA, no interlacing, each row unfiltered and the whole image
 * deflated at the highest level. Throws a `RangeError` when `pixels` doesn't match the size.
 */
export function encodePng(image: RgbaImage): Uint8Array {
  const { width, height, pixels } = image;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`invalid image size ${String(width)}x${String(height)}`);
  }
  const stride = width * 4;
  if (pixels.length !== stride * height) {
    throw new RangeError(`expected ${String(stride * height)} bytes, got ${String(pixels.length)}`);
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([bitDepth, rgbaColorType, 0, 0, 0], 8);
  const rows = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    rows.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const framed = Buffer.alloc(typeAndData.length + 8);
  framed.writeUInt32BE(data.length, 0);
  typeAndData.copy(framed, 4);
  framed.writeUInt32BE(crc32(typeAndData), typeAndData.length + 4);
  return framed;
}
