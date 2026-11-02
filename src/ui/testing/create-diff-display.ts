import type { DiffDisplayView } from '#contract/ipc-contract.ts';

/** The default diff display, with any field overridden. */
export function createDiffDisplay(overrides: Partial<DiffDisplayView> = {}): DiffDisplayView {
  return {
    layout: 'split',
    ignoreWhitespace: false,
    sidebarSide: 'right',
    showGenerated: false,
    showInsights: true,
    reviewOrder: 'path',
    skipReviewed: false,
    ...overrides,
  };
}
