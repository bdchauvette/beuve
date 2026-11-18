import { dockCheckedCommands } from './dock-checked-commands.ts';
import { test } from './testing/test.ts';

test('names the Note commands that say Restore and Mark as Not Addressed', ({ expect }) => {
  expect(dockCheckedCommands(undefined)).toStrictEqual([]);
  expect(dockCheckedCommands({ count: 1, isAddressed: false, isWithdrawn: false })).toStrictEqual(
    [],
  );
  expect(dockCheckedCommands({ count: 2, isAddressed: true, isWithdrawn: false })).toStrictEqual([
    'dock-addressed',
  ]);
  expect(dockCheckedCommands({ count: 1, isAddressed: false, isWithdrawn: true })).toStrictEqual([
    'dock-withdraw',
  ]);
});
