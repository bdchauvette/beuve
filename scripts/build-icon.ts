import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { encodeIcns } from './lib/image/encode-icns.ts';
import type { IcnsEntry } from './lib/image/encode-icns.ts';
import { encodePng } from './lib/image/encode-png.ts';
import type { RgbaImage } from './lib/image/encode-png.ts';

/** A colour layer: a signed distance (negative inside) in 1024-unit icon space. */
interface Layer {
  readonly color: readonly [number, number, number];
  readonly distance: (x: number, y: number) => number;
}

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'build');
const canvas = 1024;
/** Alabaster light: the app background and border, ink, and the accent violet (ADR 0025). */
const paper = [0xf7, 0xf7, 0xf8] as const;
const border = [0xdc, 0xdc, 0xe0] as const;
const ink = [0x1b, 0x1c, 0x20] as const;
const violet = [0x7a, 0x4f, 0xd6] as const;
const icnsTypes: readonly (readonly [string, number])[] = [
  ['icp4', 16],
  ['icp5', 32],
  ['ic11', 32],
  ['ic12', 64],
  ['ic07', 128],
  ['ic13', 256],
  ['ic08', 256],
  ['ic14', 512],
  ['ic09', 512],
  ['ic10', 1024],
];

await buildIcon();

/**
 * Draws the placeholder app icon (a lowercase "b" with a violet dot on an Alabaster squircle,
 * on Apple's 1024 grid with an 824 body) analytically at every size, so no rasterizer or image
 * dependency is needed, and writes `build/icon.icns` (macOS) and `build/icon.png` (1024, Linux and
 * the source of truth to eyeball). Rerun after changing the shapes: `node scripts/build-icon.ts`.
 */
async function buildIcon(): Promise<void> {
  const layers = iconLayers();
  const pngs = new Map<number, Uint8Array>();
  for (const [, size] of icnsTypes) {
    if (!pngs.has(size)) {
      pngs.set(size, encodePng(render(layers, size)));
    }
  }
  const entries = icnsTypes.map(([type, size]): IcnsEntry => ({
    type,
    png: pngs.get(size) ?? new Uint8Array(0),
  }));
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'icon.icns'), encodeIcns(entries));
  await writeFile(path.join(output, 'icon.png'), pngs.get(canvas) ?? new Uint8Array(0));
  console.log(`icon: wrote build/icon.icns (${String(entries.length)} images) and build/icon.png`);
}

function iconLayers(): readonly Layer[] {
  const stem = { left: 322, right: 402, top: 232, bottom: 792 };
  const bowl = { x: 552, y: 602, outer: 190, inner: 110 };
  return [
    { color: border, distance: (x, y): number => roundedBox(x, y, 512, 512, 412, 412, 185) },
    { color: paper, distance: (x, y): number => roundedBox(x, y, 512, 512, 404, 404, 177) },
    {
      color: ink,
      distance: (x, y): number =>
        Math.min(
          roundedBox(
            x,
            y,
            (stem.left + stem.right) / 2,
            (stem.top + stem.bottom) / 2,
            (stem.right - stem.left) / 2,
            (stem.bottom - stem.top) / 2,
            12,
          ),
          Math.abs(Math.hypot(x - bowl.x, y - bowl.y) - (bowl.outer + bowl.inner) / 2) -
            (bowl.outer - bowl.inner) / 2,
        ),
    },
    { color: violet, distance: (x, y): number => Math.hypot(x - 690, y - 300) - 48 },
  ];
}

/** Signed distance to an axis-aligned box centred at (cx, cy) with half sizes and corner radius. */
function roundedBox(
  x: number,
  y: number,
  cx: number,
  cy: number,
  halfWidth: number,
  halfHeight: number,
  radius: number,
): number {
  const qx = Math.abs(x - cx) - halfWidth + radius;
  const qy = Math.abs(y - cy) - halfHeight + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

/**
 * Composites the layers over transparency at `size` pixels. Coverage comes from each layer's
 * distance at the pixel centre, in pixels, clamped to one pixel of antialiasing.
 */
function render(layers: readonly Layer[], size: number): RgbaImage {
  const scale = canvas / size;
  const pixels = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const x = (column + 0.5) * scale;
      const y = (row + 0.5) * scale;
      let alpha = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (const layer of layers) {
        const coverage = Math.min(Math.max(0.5 - layer.distance(x, y) / scale, 0), 1);
        const [r, g, b] = layer.color;
        red = r * coverage + red * (1 - coverage);
        green = g * coverage + green * (1 - coverage);
        blue = b * coverage + blue * (1 - coverage);
        alpha = coverage + alpha * (1 - coverage);
      }
      const offset = (row * size + column) * 4;
      pixels[offset] = Math.round(alpha === 0 ? 0 : red / alpha);
      pixels[offset + 1] = Math.round(alpha === 0 ? 0 : green / alpha);
      pixels[offset + 2] = Math.round(alpha === 0 ? 0 : blue / alpha);
      pixels[offset + 3] = Math.round(alpha * 255);
    }
  }
  return { width: size, height: size, pixels };
}
