import { describeNoteDeletion } from './describe-note-deletion.ts';
import { test } from './testing/test.ts';

test('names one deleted note by its title and several by their count', ({ expect }) => {
  expect(describeNoteDeletion(['Off by one'])).toBe('Deleted “Off by one”.');
  expect(describeNoteDeletion(['A', 'B', 'C'])).toBe('Deleted 3 notes.');
});
