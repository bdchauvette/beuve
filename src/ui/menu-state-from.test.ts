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
        'toggle-closed-notes',
        'order-path',
      ],
    });
  });

  test.for([
    [{ focusedZone: 'diff' }, ['session', 'file', 'diff-target', 'editable-target']],
    [{ isActiveEditable: false }, ['session', 'file', 'diff-target']],
    [{ focusedZone: 'chat', isTextFocused: true }, ['session', 'file', 'text-focus']],
    [
      {
        focusedZone: 'ura',
        noteListItem: { count: 1, isAddressed: false, isWithdrawn: false, isBlocking: false },
      },
      ['session', 'file', 'note-item'],
    ],
    [{ activePath: undefined }, ['session']],
    [
      { isBusy: true, isPullRequest: true, stagedCount: 2 },
      ['session', 'file', 'diff-target', 'editable-target', 'busy', 'pull-request', 'staged'],
    ],
    [
      { isTerminalFocused: true },
      ['session', 'file', 'diff-target', 'editable-target', 'terminal-focus'],
    ],
  ] as const)('focus %o gives %o', ([change, conditions], { expect }) => {
    expect(menuStateFrom({ ...open(), ...change }).conditions).toStrictEqual(conditions);
  });

  test('checks the reviewed mark, the notes list item and find’s case', ({ expect }) => {
    const { checked } = menuStateFrom({
      ...open(),
      isActiveReviewed: true,
      focusedZone: 'ura',
      noteListItem: { count: 2, isAddressed: true, isWithdrawn: false, isBlocking: false },
      isFindCaseSensitive: true,
      reviewRange: 'whole',
      treeMode: 'diff-only',
      isTerminalShown: true,
      display: { ...open().display, layout: 'unified', reviewOrder: 'calls' },
    });
    expect(checked).toStrictEqual([
      'toggle-sidebar',
      'toggle-terminal',
      'sidebar-right',
      'diff-inline',
      'toggle-insights',
      'toggle-diagnostics',
      'toggle-closed-notes',
      'tree-mode',
      'order-calls',
      'toggle-reviewed',
      'find-match-case',
      'range-whole',
      'note-addressed',
    ]);
  });
});

function idle(): MenuStateInput {
  return {
    hasSession: false,
    activePath: undefined,
    isActiveReviewed: false,
    isActiveEditable: false,
    focusedZone: 'diff',
    noteListItem: undefined,
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
    isFindCaseSensitive: false,
    reviewRange: undefined,
  };
}

function open(): MenuStateInput {
  return {
    ...idle(),
    hasSession: true,
    activePath: 'src/a.ts',
    isActiveEditable: true,
    isSidebarShown: true,
  };
}
