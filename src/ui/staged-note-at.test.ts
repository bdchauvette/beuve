import { describe } from 'vitest';

import { stagedNoteAt } from './staged-note-at.ts';
import { test } from './testing/test.ts';
import { createUraItemView } from './testing/create-ura-item-view.ts';

describe('stagedNoteAt', () => {
  test('finds the staged note on the head shown whose lines hold the line', ({ expect }) => {
    const headSha = 'a'.repeat(40);
    const note = createUraItemView();
    const older = createUraItemView({ id: 'older', headSha: 'b'.repeat(40) });
    const posted = createUraItemView({ id: 'posted', status: { kind: 'withdrawn' } });
    const items = [older, posted, note];
    expect(stagedNoteAt(items, { path: 'src/a.ts', line: 4, headSha })?.id).toBe(note.id);
    expect(stagedNoteAt(items, { path: 'src/a.ts', line: 5, headSha })).toBeUndefined();
    expect(stagedNoteAt(items, { path: 'src/b.ts', line: 3, headSha })).toBeUndefined();
    expect(stagedNoteAt([older], { path: 'src/a.ts', line: 3, headSha })).toBeUndefined();
  });
});
