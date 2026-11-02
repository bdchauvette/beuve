import { describe } from 'vitest';

import { createUraItem } from './create-ura-item.ts';
import type { UraItemDraft } from './create-ura-item.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
import { test } from './testing/test.ts';

describe('createUraItem', () => {
  test(
    'builds a staged item with a fresh id and timestamps',
    { concurrent: false },
    ({ expect, clock, deps }) => {
      clock.set('2026-10-28T12:00:00Z');
      expect(createUraItem(draft(), deps)).toStrictEqual({
        ok: true,
        value: {
          id: testUraIds.itemId(1),
          sessionId: testUraIds.sessionId,
          headSha: testUraIds.headSha,
          anchor: draft().anchor,
          severity: 'nit',
          origin: { kind: 'human' },
          title: 'Rename x',
          body: '`x` says nothing.',
          suggestion: undefined,
          status: { kind: 'staged' },
          createdAt: '2026-10-28T12:00:00.000Z',
          updatedAt: '2026-10-28T12:00:00.000Z',
        },
      });
    },
  );

  test('validates the suggestion', ({ expect, deps }) => {
    const result = createUraItem({ ...draft(), suggestion: '@@ -3 +3 @@\n-x\n+count\n' }, deps);
    expect(result.ok && result.value.suggestion?.text).toBe(
      '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -3 +3 @@\n-x\n+count\n',
    );
    expect(createUraItem({ ...draft(), suggestion: 'nonsense' }, deps).ok).toBe(false);
  });

  test('keeps a note without a title', ({ expect, deps }) => {
    const result = createUraItem({ ...draft(), title: ' '.repeat(3) }, deps);
    expect(result.ok && result.value.title).toBe('');
  });

  test('rejects a note with no title, body or suggestion', ({ expect, deps }) => {
    expect(createUraItem({ ...draft(), title: ' ', body: '' }, deps)).toMatchObject({
      ok: false,
      error: { kind: 'invalid-text' },
    });
  });
});

function draft(): UraItemDraft {
  return {
    sessionId: testUraIds.sessionId,
    headSha: testUraIds.headSha,
    anchor: { kind: 'lines', path: 'src/a.ts', startLine: 3, endLine: 3 },
    severity: 'nit',
    origin: { kind: 'human' },
    title: '  Rename x  ',
    body: '`x` says nothing.',
  } as const;
}
