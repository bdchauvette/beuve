import type { MenuIcon } from '#contract/command-catalog.ts';

/** One drawn icon: premultiplied BGRA rows, as `nativeImage.createFromBitmap` takes them. */
export interface MenuIconBitmap {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

/** What to draw a menu icon with: pixels per point, and the ink as 0–255 red, green and blue. */
export interface MenuIconInk {
  readonly scale: number;
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

/** A stroke from one point to another, in points of the 16-point square. */
interface Stroke {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

const size = 16;
const strokeWidth = 1.5;
const samples = 4;

/** The up arrow: a shaft and a chevron, drawn by beuve (no artwork copied). */
const upArrow: readonly Stroke[] = [
  { x1: 8, y1: 3, x2: 8, y2: 13 },
  { x1: 8, y1: 3, x2: 3.5, y2: 7.5 },
  { x1: 8, y1: 3, x2: 12.5, y2: 7.5 },
];

/**
 * Draws `icon` in a 16-point square at `ink.scale` pixels per point, with round-capped strokes
 * antialiased by 4×4 supersampling (ADR 0142). The down arrow is the up arrow flipped. Pure.
 */
export function drawMenuIcon(icon: MenuIcon, ink: MenuIconInk): MenuIconBitmap {
  const side = size * ink.scale;
  const strokes = strokesOf(icon);
  const pixels = new Uint8Array(side * side * 4);
  for (let row = 0; row < side; row += 1) {
    for (let column = 0; column < side; column += 1) {
      const alpha = coverageAt({ row, column, scale: ink.scale }, strokes);
      const offset = (row * side + column) * 4;
      pixels[offset] = Math.round(ink.blue * alpha);
      pixels[offset + 1] = Math.round(ink.green * alpha);
      pixels[offset + 2] = Math.round(ink.red * alpha);
      pixels[offset + 3] = Math.round(255 * alpha);
    }
  }
  return { width: side, height: side, pixels };
}

function strokesOf(icon: MenuIcon): readonly Stroke[] {
  if (icon === 'arrow-up') {
    return upArrow;
  }
  return upArrow.map((stroke): Stroke => {
    return { x1: stroke.x1, y1: size - stroke.y1, x2: stroke.x2, y2: size - stroke.y2 };
  });
}

/** A pixel of the bitmap and how many pixels make a point. */
interface PixelPlace {
  readonly row: number;
  readonly column: number;
  readonly scale: number;
}

/** The share of the pixel's subsamples that fall inside a stroke. */
function coverageAt(pixel: PixelPlace, strokes: readonly Stroke[]): number {
  let inside = 0;
  for (let sampleRow = 0; sampleRow < samples; sampleRow += 1) {
    for (let sampleColumn = 0; sampleColumn < samples; sampleColumn += 1) {
      const x = (pixel.column + (sampleColumn + 0.5) / samples) / pixel.scale;
      const y = (pixel.row + (sampleRow + 0.5) / samples) / pixel.scale;
      const isInside = strokes.some((stroke) => {
        return distanceToStroke(stroke, { x, y }) <= strokeWidth / 2;
      });
      if (isInside) {
        inside += 1;
      }
    }
  }
  return inside / (samples * samples);
}

/** A point in points of the 16-point square. */
interface Point {
  readonly x: number;
  readonly y: number;
}

function distanceToStroke(stroke: Stroke, point: Point): number {
  const dx = stroke.x2 - stroke.x1;
  const dy = stroke.y2 - stroke.y1;
  const along = ((point.x - stroke.x1) * dx + (point.y - stroke.y1) * dy) / (dx * dx + dy * dy);
  const t = Math.min(1, Math.max(0, along));
  return Math.hypot(point.x - (stroke.x1 + t * dx), point.y - (stroke.y1 + t * dy));
}
