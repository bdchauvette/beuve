/** A window's outer rectangle in screen pixels. */
export interface WindowBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SheetBoundsInput {
  /** The display area the sheet opens on (without the menu bar and dock). */
  readonly workArea: WindowBounds;
  /** The last size and place the reviewer gave a sheet of this session, if any. */
  readonly remembered: WindowBounds | undefined;
  /** How many sheets of this session are open now; each new one steps down and right. */
  readonly openCount: number;
}

const defaultSize = { width: 760, height: 860 };
const minimumSize = { width: 420, height: 320 };
const step = 28;
const steps = 8;

/**
 * Where a new sheet (ADR 0067) opens: at the size and place the reviewer last left one of the
 * session's sheets, else a tall page centred on the work area, stepped down and right by the
 * number of sheets already open (wrapping after eight) so new sheets never hide each other
 * exactly, and kept inside the work area. Pure.
 */
export function planSheetBounds(input: SheetBoundsInput): WindowBounds {
  const { workArea, remembered } = input;
  const width = clamp(remembered?.width ?? defaultSize.width, {
    min: minimumSize.width,
    max: workArea.width,
  });
  const height = clamp(remembered?.height ?? defaultSize.height, {
    min: minimumSize.height,
    max: workArea.height,
  });
  const origin = remembered ?? {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
  };
  const offset = (input.openCount % steps) * step;
  return {
    x: clamp(origin.x + offset, { min: workArea.x, max: workArea.x + workArea.width - width }),
    y: clamp(origin.y + offset, { min: workArea.y, max: workArea.y + workArea.height - height }),
    width,
    height,
  };
}

/** Bounds for {@link clamp}; `min` wins when they cross. */
interface ClampRange {
  readonly min: number;
  readonly max: number;
}

function clamp(value: number, { min, max }: ClampRange): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
