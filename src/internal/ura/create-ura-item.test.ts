import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { createUraItem } from './create-ura-item.ts';
import { fixedUraDeps } from './testing/fixed-ura-deps.ts';
import { testUraIds } from './testing/test-ura-ids.ts';

const draft = {
  sessionId: testUraIds.sessionId,
  headSha: testUraIds.headSha,
  anchor: { kind: 'lines', path: 'src/a.ts', startLine: 3, endLine: 3 },
  severity: 'nit',
  origin: { kind: 'human' },
  title: '  Rename x  ',
  body: '`x` says nothing.',
} as const;

describe('createUraItem', () => {
  it('builds a staged item with a fresh id and timestamps', () => {
    vi.useFakeTimers({
      toFake: ['Date', 'Temporal'],
      now: Temporal.Instant.from('2026-10-28T12:00:00Z'),
    });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    expect(createUraItem(draft, fixedUraDeps())).toEqual({
      ok: true,
      value: {
        id: testUraIds.itemId(1),
        sessionId: testUraIds.sessionId,
        headSha: testUraIds.headSha,
        anchor: draft.anchor,
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
  });

  it('validates the suggestion', () => {
    const result = createUraItem(
      { ...draft, suggestion: '@@ -3 +3 @@\n-x\n+count\n' },
      fixedUraDeps(),
    );
    expect(result.ok && result.value.suggestion?.text).toBe(
      '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -3 +3 @@\n-x\n+count\n',
    );
    expect(createUraItem({ ...draft, suggestion: 'nonsense' }, fixedUraDeps()).ok).toBe(false);
  });

  it('rejects an empty title', () => {
    expect(createUraItem({ ...draft, title: ' '.repeat(3) }, fixedUraDeps())).toMatchObject({
      ok: false,
      error: { kind: 'invalid-text' },
    });
  });
});
