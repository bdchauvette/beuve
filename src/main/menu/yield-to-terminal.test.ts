import { commandCatalog } from '#contract/command-catalog.ts';
import type { MenuCondition } from '#contract/command-catalog.ts';
import { test } from '#testing/test.ts';

import { menuItemStatesFrom } from './menu-item-states-from.ts';
import { yieldToTerminal } from './yield-to-terminal.ts';

function enabledStates(conditions: MenuCondition[]): ReturnType<typeof menuItemStatesFrom> {
  return menuItemStatesFrom(commandCatalog, 'main', { conditions, checked: [] });
}

test('on Linux a focused terminal disables keyed commands but not the terminal toggle', ({
  expect,
}) => {
  const conditions: MenuCondition[] = ['session', 'terminal-focus'];
  const states = yieldToTerminal(enabledStates(conditions), {
    catalog: commandCatalog,
    conditions,
    platform: 'linux',
  });
  expect(states.get('palette')?.enabled).toBe(false);
  expect(states.get('find')?.enabled).toBe(false);
  expect(states.get('toggle-terminal')?.enabled).toBe(true);
});

test('commands without a key stay enabled under a focused terminal', ({ expect }) => {
  const conditions: MenuCondition[] = ['session', 'terminal-focus'];
  const states = yieldToTerminal(enabledStates(conditions), {
    catalog: commandCatalog,
    conditions,
    platform: 'linux',
  });
  expect(states.get('tree-mode')?.enabled).toBe(true);
});

test('nothing yields on macOS, or without a focused terminal', ({ expect }) => {
  const focused: MenuCondition[] = ['session', 'terminal-focus'];
  const mac = yieldToTerminal(enabledStates(focused), {
    catalog: commandCatalog,
    conditions: focused,
    platform: 'mac',
  });
  expect(mac.get('palette')?.enabled).toBe(true);
  const idle: MenuCondition[] = ['session'];
  const linux = yieldToTerminal(enabledStates(idle), {
    catalog: commandCatalog,
    conditions: idle,
    platform: 'linux',
  });
  expect(linux.get('palette')?.enabled).toBe(true);
});
