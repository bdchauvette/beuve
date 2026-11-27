import { describe } from 'vitest';

import { compileUraArtifact } from './compile-ura-artifact.ts';
import type { UraArtifactInput } from './compile-ura-artifact.ts';
import type { LineMapping } from './line-mapping.ts';
import { createTestUraItem } from './testing/create-test-ura-item.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
import type { UraSummary } from './ura-artifact.ts';
import { test } from './testing/test.ts';

function input(overrides: Partial<UraArtifactInput> = {}): UraArtifactInput {
  return { summary: summary(), items: [], lineMappings: [], ...overrides };
}

describe('compileUraArtifact', () => {
  test('keeps staged items in order and places them on the head', ({ expect }) => {
    const current = createTestUraItem({
      id: testUraIds.itemId(1),
      headSha: testUraIds.laterHeadSha,
      severity: 'nitpick',
    });
    const older = createTestUraItem({ id: testUraIds.itemId(2), severity: 'issue' });
    const withdrawn = createTestUraItem({
      id: testUraIds.itemId(3),
      status: { kind: 'withdrawn' },
    });
    const result = compileUraArtifact(
      input({ items: [current, withdrawn, older], lineMappings: [mapping()] }),
    );
    expect(result).toStrictEqual({
      ok: true,
      value: {
        summary: summary(),
        entries: [
          {
            item: current,
            placement: { kind: 'current', anchor: current.anchor },
            suggestions: [],
          },
          {
            item: older,
            placement: {
              kind: 'current',
              anchor: { kind: 'lines', path: 'src/app.ts', startLine: 12, endLine: 14 },
            },
            suggestions: [],
          },
        ],
        verdict: { value: 'comment', source: 'derived' },
      },
    });
  });

  test('places each suggestion on its own and derives its patch from the head texts', ({
    expect,
  }) => {
    const item = createTestUraItem({
      suggestions: [
        { path: 'src/app.ts', startLine: 4, endLine: 4, replacement: 'D' },
        { path: 'src/app.ts', startLine: 1, endLine: 1, replacement: 'A' },
        { path: 'src/app.ts', startLine: 3, endLine: 2, replacement: 'new' },
        { path: 'lib/x.ts', startLine: 1, endLine: 1, replacement: 'y' },
      ],
    });
    const [moved, touched, inserted, unread] = item.suggestions;
    const changed: LineMapping = {
      ...mapping(),
      files: [
        {
          kind: 'modified',
          path: 'src/app.ts',
          hunks: [{ oldStart: 1, oldCount: 1, newStart: 1, newCount: 3 }],
        },
      ],
    };
    const headTexts = new Map([[testUraIds.headSha, new Map([['src/app.ts', 'a\nb\nc\nd\n']])]]);
    const result = compileUraArtifact(input({ items: [item], lineMappings: [changed], headTexts }));
    expect(result.ok && result.value.entries[0]?.suggestions).toStrictEqual([
      {
        suggestion: moved,
        placement: { kind: 'current', suggestion: { ...moved, startLine: 6, endLine: 6 } },
        patch: '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,4 +1,4 @@\n a\n b\n c\n-d\n+D\n',
      },
      {
        suggestion: touched,
        placement: { kind: 'outdated', reason: 'lines-changed' },
        patch: '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,4 +1,4 @@\n-a\n+A\n b\n c\n d\n',
      },
      {
        suggestion: inserted,
        placement: { kind: 'current', suggestion: { ...inserted, startLine: 5, endLine: 4 } },
        patch: '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,4 +1,5 @@\n a\n b\n+new\n c\n d\n',
      },
      {
        suggestion: unread,
        placement: { kind: 'current', suggestion: unread },
      },
    ]);
  });

  test('marks items outdated without a mapping to this head', ({ expect }) => {
    const older = createTestUraItem();
    const elsewhere: LineMapping = { ...mapping(), toHeadSha: 'd'.repeat(40) };
    const result = compileUraArtifact(input({ items: [older], lineMappings: [elsewhere] }));
    expect(result.ok && result.value.entries[0]?.placement).toStrictEqual({
      kind: 'outdated',
      reason: 'no-line-mapping',
    });
  });

  test('marks items outdated when their lines changed', ({ expect }) => {
    const touched: LineMapping = {
      ...mapping(),
      files: [
        {
          kind: 'modified',
          path: 'src/app.ts',
          hunks: [{ oldStart: 11, oldCount: 1, newStart: 11, newCount: 1 }],
        },
      ],
    };
    const result = compileUraArtifact(
      input({ items: [createTestUraItem()], lineMappings: [touched] }),
    );
    expect(result.ok && result.value.entries[0]?.placement).toStrictEqual({
      kind: 'outdated',
      reason: 'lines-changed',
    });
  });

  test('takes a chosen verdict and keeps the derived one', ({ expect }) => {
    const items = [createTestUraItem({ severity: 'nitpick' })];
    const chosen = compileUraArtifact(input({ items, verdict: 'comment' }));
    expect(chosen.ok && chosen.value.verdict).toStrictEqual({
      value: 'comment',
      source: 'chosen',
      derived: 'approve',
    });
    const same = compileUraArtifact(input({ items, verdict: 'approve' }));
    expect(same.ok && same.value.verdict).toStrictEqual({ value: 'approve', source: 'derived' });
  });

  test('refuses to approve over a staged blocking note, but not a withdrawn one', ({ expect }) => {
    const blocking = createTestUraItem({ id: testUraIds.itemId(7), blocking: true });
    expect(compileUraArtifact(input({ items: [blocking], verdict: 'approve' }))).toStrictEqual({
      ok: false,
      error: { kind: 'approve-over-blocking', itemIds: [testUraIds.itemId(7)] },
    });
    const withdrawn = createTestUraItem({ blocking: true, status: { kind: 'withdrawn' } });
    expect(compileUraArtifact(input({ items: [withdrawn], verdict: 'approve' })).ok).toBe(true);
  });

  test('refuses items from another session', ({ expect }) => {
    const foreign = createTestUraItem({ sessionId: testUraIds.otherSessionId });
    expect(compileUraArtifact(input({ items: [foreign] }))).toStrictEqual({
      ok: false,
      error: { kind: 'foreign-item', itemId: foreign.id },
    });
  });
});

function summary(): UraSummary {
  return {
    sessionId: testUraIds.sessionId,
    change: { kind: 'local', repoPath: '/repo', baseRef: 'main', headRef: 'feature' },
    baseSha: testUraIds.baseSha,
    headSha: testUraIds.laterHeadSha,
    scope: { kind: 'full' },
  };
}

function mapping(): LineMapping {
  return {
    fromHeadSha: testUraIds.headSha,
    toHeadSha: testUraIds.laterHeadSha,
    files: [
      {
        kind: 'modified',
        path: 'src/app.ts',
        hunks: [{ oldStart: 1, oldCount: 0, newStart: 2, newCount: 2 }],
      },
    ],
  };
}
