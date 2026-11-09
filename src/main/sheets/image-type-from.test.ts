import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { imageTypeFrom } from './image-type-from.ts';
import type { ImageType } from './image-type-from.ts';

function bytesOf(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

function textOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('imageTypeFrom', () => {
  test.for<[string, Uint8Array, ImageType | undefined]>([
    ['PNG', bytesOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0), 'image/png'],
    ['JPEG', bytesOf(0xff, 0xd8, 0xff, 0xe0), 'image/jpeg'],
    ['GIF', textOf('GIF89a'), 'image/gif'],
    ['WebP', bytesOf(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50), 'image/webp'],
    ['SVG', textOf('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml'],
    [
      'SVG after a declaration, a comment and a doctype',
      textOf(`\u{FEFF}<?xml version="1.0"?>\n<!-- logo -->\n<!DOCTYPE svg>\n<svg>`),
      'image/svg+xml',
    ],
    ['HTML', textOf('<html><svg></svg></html>'), undefined],
    ['text named .png', textOf('not an image'), undefined],
    [
      'RIFF that is not WebP',
      bytesOf(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45),
      undefined,
    ],
    ['nothing', bytesOf(), undefined],
  ])('%s', ([, bytes, expected], { expect }) => {
    expect(imageTypeFrom(bytes)).toBe(expected);
  });
});
