import { noteListCheckedCommands } from './note-list-checked-commands.ts';
import type { NoteListSelectionFacts } from './note-list-selection-facts.ts';
import { test } from './testing/test.ts';

test('names the Note commands that say Restore and Mark as Not …', ({ expect }) => {
  expect(noteListCheckedCommands(undefined)).toStrictEqual([]);
  expect(noteListCheckedCommands(facts({}))).toStrictEqual([]);
  expect(noteListCheckedCommands(facts({ count: 2, isAddressed: true }))).toStrictEqual([
    'note-addressed',
  ]);
  expect(noteListCheckedCommands(facts({ isWithdrawn: true, isBlocking: true }))).toStrictEqual([
    'note-withdraw',
    'note-blocking',
  ]);
});

test('checks the Status and Label the notes all share', ({ expect }) => {
  expect(noteListCheckedCommands(facts({ status: 'staged', severity: 'nitpick' }))).toStrictEqual([
    'note-status-open',
    'note-label-nitpick',
  ]);
  expect(noteListCheckedCommands(facts({ isAddressed: true, status: 'addressed' }))).toStrictEqual([
    'note-addressed',
    'note-status-addressed',
  ]);
});

function facts(overrides: Partial<NoteListSelectionFacts>): NoteListSelectionFacts {
  return { count: 1, isAddressed: false, isWithdrawn: false, isBlocking: false, ...overrides };
}
