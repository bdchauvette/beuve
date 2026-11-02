/** Where a hover is anchored, in viewport coordinates: the pointer's x and the token's top and bottom. */
export interface HoverAnchor {
  readonly x: number;
  readonly top: number;
  readonly bottom: number;
}

export interface HoverSize {
  readonly width: number;
  readonly height: number;
}

/** The window's inner size. */
export interface HoverViewport {
  readonly width: number;
  readonly height: number;
}

/** The top-left corner of a card, in viewport coordinates. */
export interface HoverPlacement {
  readonly left: number;
  readonly top: number;
}

const gap = 6;
const margin = 8;

/**
 * Where to put a hover card of `size` for `anchor` in a viewport of `viewport`: below the token,
 * above it when there is no room below but there is above, else on the side with more room. It
 * always stays `margin` clear of the viewport's edges (a card taller than the room is clamped to
 * the top, and the caller scrolls its body). Pure.
 */
export function placeHoverCard(
  anchor: HoverAnchor,
  size: HoverSize,
  viewport: HoverViewport,
): HoverPlacement {
  const below = anchor.bottom + gap;
  const above = anchor.top - gap - size.height;
  const roomBelow = viewport.height - margin - below;
  const roomAbove = anchor.top - gap - margin;
  let top = below;
  if (size.height > roomBelow && (size.height <= roomAbove || roomAbove > roomBelow)) {
    top = above;
  }
  const left = Math.min(anchor.x, viewport.width - margin - size.width);
  return { left: Math.max(margin, left), top: Math.max(margin, top) };
}
