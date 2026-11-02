import type { SidebarSideView } from '#contract/ipc-contract.ts';

import { clampSidebarWidth } from './clamp-sidebar-width.ts';

/** Options of {@link sidebarWidthForKey}. */
export interface SidebarWidthForKeyOptions {
  readonly key: string;
  readonly isShift: boolean;
  readonly side: SidebarSideView;
  /** The sidebar's width now, in px. */
  readonly current: number;
  /** The width of the workspace the sidebar sits in, in px. */
  readonly available: number;
}

const growKeys: Readonly<Record<SidebarSideView, string>> = {
  left: 'ArrowRight',
  right: 'ArrowLeft',
};

const otherSide: Readonly<Record<SidebarSideView, SidebarSideView>> = {
  left: 'right',
  right: 'left',
};

/**
 * The width a key on the sidebar's handle asks for: the arrow that points away from the sidebar
 * widens it by 16 px (64 with Shift), the other one narrows it. `undefined` for any other key. Pure.
 */
export function sidebarWidthForKey(options: SidebarWidthForKeyOptions): number | undefined {
  const growKey = growKeys[options.side];
  const shrinkKey = growKeys[otherSide[options.side]];
  if (options.key !== growKey && options.key !== shrinkKey) {
    return undefined;
  }
  let step = 16;
  if (options.isShift) {
    step = 64;
  }
  if (options.key === shrinkKey) {
    step = -step;
  }
  return clampSidebarWidth({ width: options.current + step, available: options.available });
}
