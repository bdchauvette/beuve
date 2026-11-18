import type { MenuIcon } from '#contract/command-catalog.ts';
import { test } from '#testing/test.ts';

import { drawMenuIcon } from './draw-menu-icon.ts';
import type { MenuIconBitmap } from './draw-menu-icon.ts';

test('draws a 16-point square at the scale asked for', ({ expect }) => {
  const bitmap = drawMenuIcon('arrow-up', { scale: 2, red: 0, green: 0, blue: 0 });
  expect([bitmap.width, bitmap.height, bitmap.pixels.length]).toStrictEqual([32, 32, 32 * 32 * 4]);
});

test('inks the shaft and leaves the corners clear', ({ expect }) => {
  const bitmap = drawMenuIcon('arrow-up', { scale: 1, red: 255, green: 0, blue: 0 });
  expect(alphaAt(bitmap, { x: 8, y: 10 })).toBeGreaterThan(0);
  expect(alphaAt(bitmap, { x: 0, y: 0 })).toBe(0);
  expect(alphaAt(bitmap, { x: 15, y: 15 })).toBe(0);
});

test('writes the ink in BGRA order, scaled by its coverage', ({ expect }) => {
  const bitmap = drawMenuIcon('arrow-up', { scale: 2, red: 200, green: 100, blue: 50 });
  expect(pixelAt(bitmap, { x: 15, y: 20 })).toStrictEqual([50, 100, 200, 255]);
  expect(pixelAt(bitmap, { x: 2, y: 20 })).toStrictEqual([0, 0, 0, 0]);
});

test('points the arrows opposite ways, the down one being the up one flipped', ({ expect }) => {
  const up = drawMenuIcon('arrow-up', { scale: 1, red: 0, green: 0, blue: 0 });
  const down = drawMenuIcon('arrow-down', { scale: 1, red: 0, green: 0, blue: 0 });
  expect(alphaAt(up, { x: 4, y: 6 })).toBeGreaterThan(0);
  expect(alphaAt(down, { x: 4, y: 6 })).toBe(0);
  expect(rowsOf(down)).toStrictEqual(rowsOf(up).toReversed());
});

test.for(['arrow-up', 'arrow-down'] as const satisfies readonly MenuIcon[])(
  'draws %s the same every time',
  (icon, { expect }) => {
    const first = drawMenuIcon(icon, { scale: 2, red: 0, green: 0, blue: 0 });
    const second = drawMenuIcon(icon, { scale: 2, red: 0, green: 0, blue: 0 });
    expect(second.pixels).toStrictEqual(first.pixels);
  },
);

/** A pixel of a bitmap, by column and row. */
interface Pixel {
  readonly x: number;
  readonly y: number;
}

function alphaAt(bitmap: MenuIconBitmap, pixel: Pixel): number {
  return bitmap.pixels[(pixel.y * bitmap.width + pixel.x) * 4 + 3] ?? 0;
}

function pixelAt(bitmap: MenuIconBitmap, pixel: Pixel): number[] {
  const offset = (pixel.y * bitmap.width + pixel.x) * 4;
  return [...bitmap.pixels.slice(offset, offset + 4)];
}

function rowsOf(bitmap: MenuIconBitmap): string[] {
  const rows: string[] = [];
  for (let row = 0; row < bitmap.height; row += 1) {
    const start = row * bitmap.width * 4;
    rows.push(bitmap.pixels.slice(start, start + bitmap.width * 4).join(','));
  }
  return rows;
}
