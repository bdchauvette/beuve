import type { DiffDisplayView, SetDiffDisplayRequest } from '#contract/ipc-contract.ts';

import type { CommandId } from '#contract/command-catalog.ts';

/** The catalog commands that change the diff display. */
export type DisplayCommandId = Extract<
  CommandId,
  | 'diff-split'
  | 'diff-inline'
  | 'whitespace'
  | 'toggle-generated'
  | 'toggle-insights'
  | 'toggle-diagnostics'
  | 'toggle-skip-reviewed'
  | 'order-path'
  | 'order-imports'
  | 'order-calls'
  | 'sheets-window'
  | 'sheets-inline'
>;

/** The display change a menu, shortcut or palette command asks for, given the current display. Pure. */
export function displayChangeFor(
  id: DisplayCommandId,
  display: DiffDisplayView,
): SetDiffDisplayRequest {
  switch (id) {
    case 'diff-split': {
      return { layout: 'split' };
    }
    case 'diff-inline': {
      return { layout: 'unified' };
    }
    case 'whitespace': {
      return { ignoreWhitespace: !display.ignoreWhitespace };
    }
    case 'toggle-generated': {
      return { showGenerated: !display.showGenerated };
    }
    case 'toggle-insights': {
      return { showInsights: !display.showInsights };
    }
    case 'toggle-diagnostics': {
      return { showDiagnostics: !display.showDiagnostics };
    }
    case 'toggle-skip-reviewed': {
      return { skipReviewed: display.skipReviewed !== true };
    }
    case 'order-path': {
      return { reviewOrder: 'path' };
    }
    case 'order-imports': {
      return { reviewOrder: 'imports' };
    }
    case 'order-calls': {
      return { reviewOrder: 'calls' };
    }
    case 'sheets-window': {
      return { sheets: 'window' };
    }
    case 'sheets-inline': {
      return { sheets: 'inline' };
    }
  }
}
