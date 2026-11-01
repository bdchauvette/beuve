import type { CommandId, MenuCondition } from '#contract/command-catalog.ts';
import type { DiffDisplayView, EditorId, MenuStateRequest } from '#contract/ipc-contract.ts';

import type { RadarTreeMode } from './plan-radar-tree.ts';
import type { SheetHistoryState } from './step-sheet-history.ts';
import type { ZoneId } from './zones.ts';

/** What the main window knows that decides its menu items (ADR 0068). */
export interface MenuStateInput {
  readonly hasSession: boolean;
  /** The file the diff's cursor is on; absent with no file. */
  readonly activePath: string | undefined;
  /** Whether the reviewer marked the file under the cursor (the tree's, or else the diff's). */
  readonly isActiveReviewed: boolean;
  readonly focusedZone: ZoneId;
  /** The dock item under its cursor, while the dock has the focus. */
  readonly dockItem: { readonly isAddressed: boolean } | undefined;
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
  readonly preferredEditor: EditorId | undefined;
  readonly isFindCaseSensitive: boolean;
  /** The inline sheet's history, while it has the focus. */
  readonly sheetHistory: SheetHistoryState | undefined;
}

/**
 * The main window's `menu:set-state`: conditions from focus and contents, and the toggles that
 * show checked. A text field suspends the chords it uses itself (main applies `text-focus`).
 * Pure.
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
    ...has('back', input.sheetHistory?.canGoBack === true),
    ...has('forward', input.sheetHistory?.canGoForward === true),
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
    ['tree-mode', input.treeMode === 'diff-only'],
    ['order-path', order === 'path'],
    ['order-imports', order === 'imports'],
    ['order-calls', order === 'calls'],
    ['sheets-window', (display.sheets ?? 'window') === 'window'],
    ['sheets-inline', display.sheets === 'inline'],
    ['toggle-skip-reviewed', display.skipReviewed === true],
    ['toggle-reviewed', isFile && input.isActiveReviewed],
    ['editor-zed', input.preferredEditor === 'zed'],
    ['editor-vscode', input.preferredEditor === 'vscode'],
    ['editor-cursor', input.preferredEditor === 'cursor'],
    ['dock-addressed', input.dockItem?.isAddressed === true],
    ['find-match-case', input.isFindCaseSensitive],
  ];
  return {
    conditions,
    checked: checks.filter(([, isChecked]) => isChecked).map(([id]) => id),
  };
}
