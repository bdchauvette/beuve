import { dockCheckedCommands } from './dock-checked-commands.ts';
import type { DockSelectionFacts } from './dock-selection-facts.ts';
import { test } from './testing/test.ts';

test('names the Note commands that say Restore and Mark as Not …', ({ expect }) => {
  expect(dockCheckedCommands(undefined)).toStrictEqual([]);
  expect(dockCheckedCommands(facts({}))).toStrictEqual([]);
  expect(dockCheckedCommands(facts({ count: 2, isAddressed: true }))).toStrictEqual([
    'dock-addressed',
  ]);
  expect(dockCheckedCommands(facts({ isWithdrawn: true, isBlocking: true }))).toStrictEqual([
    'dock-withdraw',
    'dock-blocking',
  ]);
});

function facts(overrides: Partial<DockSelectionFacts>): DockSelectionFacts {
  return { count: 1, isAddressed: false, isWithdrawn: false, isBlocking: false, ...overrides };
}
