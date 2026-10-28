import { describe, expect, it } from 'vitest';

import { createUraItemView } from './testing/create-ura-item-view.ts';
import { toUraMarkers } from './to-ura-markers.ts';

describe('toUraMarkers', () => {
  it('marks staged items placed on the file, whole-file notes at line 0', () => {
    const lines = createUraItemView({ id: 'l' });
    const file = createUraItemView({
      id: 'f',
      anchor: { kind: 'file', path: 'src/a.ts' },
      placement: { kind: 'current', anchor: { kind: 'file', path: 'src/a.ts' } },
    });
    expect(toUraMarkers('src/a.ts', [lines, file])).toEqual([
      { lineStart: 3, lineEnd: 4, item: lines },
      { lineStart: 0, lineEnd: 0, item: file },
    ]);
  });

  it('follows the current placement of re-anchored items', () => {
    const moved = createUraItemView({
      placement: {
        kind: 'current',
        anchor: { kind: 'lines', path: 'src/b.ts', startLine: 9, endLine: 9 },
      },
    });
    expect(toUraMarkers('src/a.ts', [moved])).toEqual([]);
    const marker = { lineStart: 9, lineEnd: 9, item: moved };
    expect(toUraMarkers('src/b.ts', [moved])).toEqual([marker]);
  });

  it('skips outdated, withdrawn, addressed and whole-change items', () => {
    const addressedAt = 'b'.repeat(40);
    const skipped = [
      createUraItemView({ placement: { kind: 'outdated', reason: 'lines-changed' } }),
      createUraItemView({ status: { kind: 'withdrawn' } }),
      createUraItemView({ status: { kind: 'addressed', atSha: addressedAt, by: 'reviewer' } }),
      createUraItemView({ placement: { kind: 'current', anchor: { kind: 'change' } } }),
    ];
    expect(toUraMarkers('src/a.ts', skipped)).toEqual([]);
  });
});
