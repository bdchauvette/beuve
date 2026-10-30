import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { commandCatalog } from '#contract/command-catalog.ts';
import type { CommandId, MenuCondition, WindowKind } from '#contract/command-catalog.ts';

import { menuItemStatesFrom } from './menu-item-states-from.ts';

describe('menuItemStatesFrom', () => {
  test.for([
    { kind: 'main', conditions: [], id: 'stage', enabled: false },
    { kind: 'main', conditions: ['session'], id: 'stage', enabled: false },
    { kind: 'main', conditions: ['session', 'diff-target'], id: 'stage', enabled: true },
    { kind: 'main', conditions: ['session'], id: 'next-hunk', enabled: true },
    { kind: 'main', conditions: ['session', 'text-focus'], id: 'next-hunk', enabled: false },
    { kind: 'main', conditions: ['session', 'text-focus'], id: 'palette', enabled: true },
    { kind: 'main', conditions: ['session', 'text-focus'], id: 'add-to-chat', enabled: true },
    { kind: 'sheet', conditions: ['session'], id: 'next-hunk', enabled: true },
    { kind: 'sheet', conditions: ['session', 'diff-target'], id: 'stage', enabled: false },
    { kind: 'sheet', conditions: ['back'], id: 'back', enabled: true },
    { kind: 'sheet', conditions: ['back', 'text-focus'], id: 'back', enabled: false },
    { kind: 'settings', conditions: ['session'], id: 'open', enabled: false },
    { kind: 'settings', conditions: [], id: 'settings', enabled: true },
    { kind: 'settings', conditions: [], id: 'close-all-sheets', enabled: true },
  ] satisfies readonly {
    kind: WindowKind;
    conditions: MenuCondition[];
    id: CommandId;
    enabled: boolean;
  }[])(
    '$kind with [$conditions]: $id enabled $enabled',
    ({ kind, conditions, id, enabled }, { expect }) => {
      expect(
        menuItemStatesFrom(commandCatalog, kind, { conditions, checked: [] }).get(id),
      ).toStrictEqual({
        enabled,
        checked: false,
      });
    },
  );

  test('checks only toggles the window listed', ({ expect }) => {
    const states = menuItemStatesFrom(commandCatalog, 'main', {
      conditions: ['session', 'file'],
      checked: ['whitespace', 'toggle-reviewed', 'stage'],
    });
    expect(states.get('whitespace')?.checked).toBe(true);
    expect(states.get('toggle-reviewed')).toStrictEqual({ enabled: true, checked: true });
    expect(states.get('stage')?.checked).toBe(false);
    expect(states.get('toggle-generated')?.checked).toBe(false);
  });

  test('covers every catalog command', ({ expect }) => {
    const states = menuItemStatesFrom(commandCatalog, 'main', { conditions: [], checked: [] });
    expect(states.size).toBe(commandCatalog.length);
    expect(commandCatalog.filter((command) => !states.has(command.id))).toStrictEqual([]);
  });
});
