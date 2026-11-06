import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { menuStateFrom } from './menu-state-from.ts';
import type { MenuStateInput } from './menu-state-from.ts';

describe('menuStateFrom', () => {
  test('reports nothing but the display toggles with no session', ({ expect }) => {
    expect(menuStateFrom(idle())).toStrictEqual({
      conditions: [],
      checked: [
        'sidebar-right',
        'diff-split',
        'toggle-insights',
        'toggle-diagnostics',
        'order-path',
        'sheets-window',
      ],
    });
  });

  test.for([
    [{ focusedZone: 'diff' }, ['session', 'file', 'diff-target']],
    [{ focusedZone: 'chat', isTextFocused: true }, ['session', 'file', 'text-focus']],
    [{ focusedZone: 'ura', dockItem: { isAddressed: false } }, ['session', 'file', 'dock-item']],
    [{ activePath: undefined }, ['session']],
    [
      { isBusy: true, isPullRequest: true, stagedCount: 2 },
      ['session', 'file', 'diff-target', 'busy', 'pull-request', 'staged'],
    ],
    [
      { sheetHistory: { canGoBack: true, canGoForward: false } },
      ['session', 'file', 'diff-target', 'back'],
    ],
    [{ isTerminalFocused: true }, ['session', 'file', 'diff-target', 'terminal-focus']],
  ] as const)('focus %o gives %o', ([change, conditions], { expect }) => {
    expect(menuStateFrom({ ...open(), ...change }).conditions).toStrictEqual(conditions);
  });

  test('checks the reviewed mark, the editor, the dock item and find’s case', ({ expect }) => {
    const { checked } = menuStateFrom({
      ...open(),
      isActiveReviewed: true,
      preferredEditor: 'vscode',
      focusedZone: 'ura',
      dockItem: { isAddressed: true },
      isFindCaseSensitive: true,
      treeMode: 'diff-only',
      isTerminalShown: true,
      display: { ...open().display, layout: 'unified', reviewOrder: 'calls', sheets: 'inline' },
    });
    expect(checked).toStrictEqual([
      'toggle-sidebar',
      'toggle-terminal',
      'sidebar-right',
      'diff-inline',
      'toggle-insights',
      'toggle-diagnostics',
      'tree-mode',
      'order-calls',
      'sheets-inline',
      'toggle-reviewed',
      'editor-vscode',
      'dock-addressed',
      'find-match-case',
    ]);
  });
});

function idle(): MenuStateInput {
  return {
    hasSession: false,
    activePath: undefined,
    isActiveReviewed: false,
    focusedZone: 'diff',
    dockItem: undefined,
    isTextFocused: false,
    isBusy: false,
    isPullRequest: false,
    stagedCount: 0,
    isSidebarShown: false,
    isTerminalShown: false,
    isTerminalFocused: false,
    display: {
      layout: 'split',
      ignoreWhitespace: false,
      sidebarSide: 'right',
      showGenerated: false,
      showInsights: true,
      showDiagnostics: true,
    },
    treeMode: 'neighborhood',
    preferredEditor: undefined,
    isFindCaseSensitive: false,
    sheetHistory: undefined,
  };
}

function open(): MenuStateInput {
  return { ...idle(), hasSession: true, activePath: 'src/a.ts', isSidebarShown: true };
}
