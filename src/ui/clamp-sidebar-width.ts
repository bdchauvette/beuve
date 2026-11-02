import { sidebarWidthLimits } from './sidebar-width-limits.ts';

/** Options of {@link clampSidebarWidth}. */
export interface ClampSidebarWidthOptions {
  /** The width asked for, in px. */
  readonly width: number;
  /** The width of the workspace the sidebar sits in, in px. */
  readonly available: number;
}

/**
 * The sidebar width to use for a request: whole pixels, at least the minimum, at most the maximum
 * and at most 60% of the workspace, but never under the minimum. Pure.
 */
export function clampSidebarWidth(options: ClampSidebarWidthOptions): number {
  const { min, max } = sidebarWidthLimits;
  const widest = Math.max(min, Math.min(max, options.available * 0.6));
  return Math.round(Math.min(widest, Math.max(min, options.width)));
}
