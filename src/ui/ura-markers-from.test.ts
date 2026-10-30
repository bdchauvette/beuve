import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { createUraItemView } from './testing/create-ura-item-view.ts';
import { uraMarkersFrom } from './ura-markers-from.ts';

describe('uraMarkersFrom', () => {
  test('marks staged items placed on the file, whole-file notes at line 0', ({ expect }) => {
    const lines = createUraItemView({ id: 'l' });
    const file = createUraItemView({
      id: 'f',
      anchor: { kind: 'file', path: 'src/a.ts' },
      placement: { kind: 'current', anchor: { kind: 'file', path: 'src/a.ts' } },
    });
    expect(uraMarkersFrom('src/a.ts', [lines, file])).toStrictEqual([
      { lineStart: 3, lineEnd: 4, item: lines },
      { lineStart: 0, lineEnd: 0, item: file },
    ]);
  });

  test('follows the current placement of re-anchored items', ({ expect }) => {
    const moved = createUraItemView({
      placement: {
        kind: 'current',
        anchor: { kind: 'lines', path: 'src/b.ts', startLine: 9, endLine: 9 },
      },
    });
    expect(uraMarkersFrom('src/a.ts', [moved])).toStrictEqual([]);
    const marker = { lineStart: 9, lineEnd: 9, item: moved };
    expect(uraMarkersFrom('src/b.ts', [moved])).toStrictEqual([marker]);
  });

  test('skips outdated, withdrawn, addressed and whole-change items', ({ expect }) => {
    const addressedAt = 'b'.repeat(40);
    const skipped = [
      createUraItemView({ placement: { kind: 'outdated', reason: 'lines-changed' } }),
      createUraItemView({ status: { kind: 'withdrawn' } }),
      createUraItemView({ status: { kind: 'addressed', atSha: addressedAt, by: 'reviewer' } }),
      createUraItemView({ placement: { kind: 'current', anchor: { kind: 'change' } } }),
    ];
    expect(uraMarkersFrom('src/a.ts', skipped)).toStrictEqual([]);
  });
});
