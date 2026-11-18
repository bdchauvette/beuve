import type { CommandId, MenuCondition } from '#contract/command-catalog.ts';
import type {
  DiffDisplayView,
  MenuStateRequest,
  ReviewRangeChoiceView,
} from '#contract/ipc-contract.ts';

import { dockCheckedCommands } from './dock-checked-commands.ts';
import type { DockSelectionFacts } from './dock-selection-facts.ts';
import type { RadarTreeMode } from './plan-radar-tree.ts';
import type { ZoneId } from './zones.ts';

/** What the main window knows that decides its menu items (ADR 0068). */
export interface MenuStateInput {
  readonly hasSession: boolean;
  /** The file the diff's cursor is on; absent with no file. */
  readonly activePath: string | undefined;
  /** Whether the reviewer marked the file under the cursor (the tree's, or else the diff's). */
  readonly isActiveReviewed: boolean;
  readonly focusedZone: ZoneId;
  /** The dock's selected notes (or the one under its cursor), while the dock has the focus. */
  readonly dockItem: DockSelectionFacts | undefined;
  readonly isTextFocused: boolean;
  readonly isBusy: boolean;
  readonly isPullRequest: boolean;
  readonly stagedCount: number;
  readonly isSidebarShown: boolean;
  readonly isTerminalShown: boolean;
  /** Whether a terminal of the panel has the keyboard (ADR 0095). */
  readonly isTerminalFocused: boolean;
  readonly display: DiffDisplayView;
  readonly treeMode: RadarTreeMode;
  readonly isFindCaseSensitive: boolean;
  /** The range the open review shows (ADR 0140), for Review ▸ Show. */
  readonly reviewRange: ReviewRangeChoiceView['kind'] | undefined;
}

/**
 * The main window's `menu:set-state`: conditions from focus and contents, and the toggles that
 * show checked, or that show their checked names (ADR 0142). A text field suspends the chords it uses itself (main applies `text-focus`).
 * Review › Open With's check is main's own: it knows the editors (ADR 0139). Pure.
 */
export function menuStateFrom(input: MenuStateInput): MenuStateRequest {
  const has = (condition: MenuCondition, isOn: boolean): MenuCondition[] => {
    if (isOn) {
      return [condition];
    }
    return [];
  };
  const { display } = input;
  const isFile = input.hasSession && input.activePath !== undefined;
  const conditions: MenuCondition[] = [
    ...has('session', input.hasSession),
    ...has('file', isFile),
    ...has('diff-target', isFile && input.focusedZone === 'diff'),
    ...has('dock-item', input.hasSession && input.dockItem !== undefined),
    ...has('busy', input.isBusy),
    ...has('pull-request', input.isPullRequest),
    ...has('staged', input.stagedCount > 0),
    ...has('text-focus', input.isTextFocused),
    ...has('terminal-focus', input.isTerminalFocused),
  ];
  const order = display.reviewOrder ?? 'path';
  const checks: readonly (readonly [CommandId, boolean])[] = [
    ['toggle-sidebar', input.isSidebarShown],
    ['toggle-terminal', input.isTerminalShown],
    ['sidebar-left', display.sidebarSide === 'left'],
    ['sidebar-right', display.sidebarSide === 'right'],
    ['diff-split', display.layout === 'split'],
    ['diff-inline', display.layout === 'unified'],
    ['whitespace', display.ignoreWhitespace],
    ['toggle-generated', display.showGenerated],
    ['toggle-insights', display.showInsights],
    ['toggle-diagnostics', display.showDiagnostics],
    ['toggle-review-comments', display.showReviewComments === true],
    ['tree-mode', input.treeMode === 'diff-only'],
    ['order-path', order === 'path'],
    ['order-imports', order === 'imports'],
    ['order-calls', order === 'calls'],
    ['order-size', order === 'size'],
    ['toggle-skip-reviewed', display.skipReviewed === true],
    ['toggle-reviewed', isFile && input.isActiveReviewed],
    ['find-match-case', input.isFindCaseSensitive],
    ['range-since-saved', input.reviewRange === 'since-last'],
    ['range-whole', input.reviewRange === 'whole'],
  ];
  return {
    conditions,
    checked: [
      ...checks.filter(([, isChecked]) => isChecked).map(([id]) => id),
      ...dockCheckedCommands(input.dockItem),
    ],
  };
}
