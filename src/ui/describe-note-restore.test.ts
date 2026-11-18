import { describeNoteRestore } from './describe-note-restore.ts';
import { test } from './testing/test.ts';

test.for([
  [
    { isRestored: true, count: 1 },
    { tone: 'info', text: 'Note restored.' },
  ],
  [
    { isRestored: true, count: 3 },
    { tone: 'info', text: 'Notes restored.' },
  ],
  [
    { isRestored: false, count: 1 },
    { tone: 'error', text: 'That note can no longer be restored.' },
  ],
  [
    { isRestored: false, count: 2 },
    { tone: 'error', text: 'Those notes can no longer be restored.' },
  ],
] as const)('says %o as %o', ([restore, notice], { expect }) => {
  expect(describeNoteRestore(restore)).toStrictEqual(notice);
});
