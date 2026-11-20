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

test('checks the Status and Label the notes all share', ({ expect }) => {
  expect(dockCheckedCommands(facts({ status: 'staged', severity: 'nitpick' }))).toStrictEqual([
    'dock-status-open',
    'dock-label-nitpick',
  ]);
  expect(dockCheckedCommands(facts({ isAddressed: true, status: 'addressed' }))).toStrictEqual([
    'dock-addressed',
    'dock-status-addressed',
  ]);
});

function facts(overrides: Partial<DockSelectionFacts>): DockSelectionFacts {
  return { count: 1, isAddressed: false, isWithdrawn: false, isBlocking: false, ...overrides };
}
