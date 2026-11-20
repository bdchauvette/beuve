import { describe } from 'vitest';

import { noteMarksFrom } from './note-marks-from.ts';
import { createUraItemView } from './testing/create-ura-item-view.ts';
import { test } from './testing/test.ts';

describe('noteMarksFrom', () => {
  test('marks nothing on an open, current, unposted note that does not block', ({ expect }) => {
    expect(noteMarksFrom(createUraItemView())).toStrictEqual([]);
  });

  test('marks Blocking, Outdated, Posted and Addressed in that order', ({ expect }) => {
    const item = createUraItemView({
      blocking: true,
      placement: { kind: 'outdated', reason: 'lines-changed' },
      posted: { url: 'https://github.com/o/r/pull/1', placement: 'inline', postedAt: 'now' },
      status: { kind: 'addressed', atSha: 'b'.repeat(40), by: 'agent' },
    });
    expect(noteMarksFrom(item)).toStrictEqual([
      {
        kind: 'blocking',
        text: 'Blocking',
        title: 'Approving is refused while this note is open',
      },
      {
        kind: 'outdated',
        text: 'Outdated',
        title:
          'The lines changed. It is still exported, with the lines it was written on (aaaaaaa).',
      },
      { kind: 'posted', text: 'Posted', title: 'Posted to GitHub inline' },
      { kind: 'addressed', text: 'Addressed', title: 'Marked addressed by an agent at bbbbbbb' },
    ]);
  });

  test('marks a withdrawn note, still blocking', ({ expect }) => {
    const item = createUraItemView({ blocking: true, status: { kind: 'withdrawn' } });
    expect(noteMarksFrom(item).map((mark) => mark.text)).toStrictEqual(['Blocking', 'Withdrawn']);
  });
});
