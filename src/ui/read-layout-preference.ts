import type { LayoutIdView, SidebarSideView } from '#contract/ipc-contract.ts';

export interface LayoutPreference {
  readonly layout?: LayoutIdView;
  readonly sidebarSide?: SidebarSideView;
}

const storageKey = 'beuve.layout';
const layouts: readonly LayoutIdView[] = ['a', 'b', 'c'];
const sides: readonly SidebarSideView[] = ['left', 'right'];

/**
 * The layout the reviewer last chose in this window's storage, if readable. A per-viewer
 * convenience for comparing the prototypes; a merged layout moves the side to `settings.json`.
 */
export function readLayoutPreference(): LayoutPreference {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    if (typeof parsed !== 'object' || parsed === null) {
      return {};
    }
    const { layout, sidebarSide } = parsed as Record<string, unknown>;
    return {
      ...(isOneOf(layout, layouts) && { layout }),
      ...(isOneOf(sidebarSide, sides) && { sidebarSide }),
    };
  } catch {
    return {};
  }
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && (options as readonly string[]).includes(value);
}
