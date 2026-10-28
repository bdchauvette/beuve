import { describe, expect, it } from 'vitest';

import { compileUraArtifact } from './compile-ura-artifact.ts';
import type { UraArtifactInput } from './compile-ura-artifact.ts';
import type { LineMapping } from './line-mapping.ts';
import { createTestUraItem } from './testing/create-test-ura-item.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
import type { UraSummary } from './ura-artifact.ts';

const { itemId, headSha, laterHeadSha } = testUraIds;

const summary: UraSummary = {
  sessionId: testUraIds.sessionId,
  change: { kind: 'local', repoPath: '/repo', baseRef: 'main', headRef: 'feature' },
  baseSha: testUraIds.baseSha,
  headSha: laterHeadSha,
  scope: { kind: 'full' },
};

const mapping: LineMapping = {
  fromHeadSha: headSha,
  toHeadSha: laterHeadSha,
  files: [
    {
      kind: 'modified',
      path: 'src/app.ts',
      hunks: [{ oldStart: 1, oldCount: 0, newStart: 2, newCount: 2 }],
    },
  ],
};

function input(overrides: Partial<UraArtifactInput> = {}): UraArtifactInput {
  return { summary, items: [], lineMappings: [], ...overrides };
}

describe('compileUraArtifact', () => {
  it('keeps staged items in order and places them on the head', () => {
    const current = createTestUraItem({ id: itemId(1), headSha: laterHeadSha, severity: 'nit' });
    const older = createTestUraItem({ id: itemId(2), severity: 'issue' });
    const withdrawn = createTestUraItem({ id: itemId(3), status: { kind: 'withdrawn' } });
    const result = compileUraArtifact(
      input({ items: [current, withdrawn, older], lineMappings: [mapping] }),
    );
    expect(result).toEqual({
      ok: true,
      value: {
        summary,
        entries: [
          { item: current, placement: { kind: 'current', anchor: current.anchor } },
          {
            item: older,
            placement: {
              kind: 'current',
              anchor: { kind: 'lines', path: 'src/app.ts', startLine: 12, endLine: 14 },
            },
          },
        ],
        verdict: { value: 'comment', source: 'derived' },
      },
    });
  });

  it('marks items outdated without a mapping to this head', () => {
    const older = createTestUraItem();
    const elsewhere: LineMapping = { ...mapping, toHeadSha: 'd'.repeat(40) };
    const result = compileUraArtifact(input({ items: [older], lineMappings: [elsewhere] }));
    expect(result.ok && result.value.entries[0]?.placement).toEqual({
      kind: 'outdated',
      reason: 'no-line-mapping',
    });
  });

  it('marks items outdated when their lines changed', () => {
    const touched: LineMapping = {
      ...mapping,
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
    expect(result.ok && result.value.entries[0]?.placement).toEqual({
      kind: 'outdated',
      reason: 'lines-changed',
    });
  });

  it('takes a chosen verdict and keeps the derived one', () => {
    const items = [createTestUraItem({ severity: 'nit' })];
    const chosen = compileUraArtifact(input({ items, verdict: 'comment' }));
    expect(chosen.ok && chosen.value.verdict).toEqual({
      value: 'comment',
      source: 'chosen',
      derived: 'approve',
    });
    const same = compileUraArtifact(input({ items, verdict: 'approve' }));
    expect(same.ok && same.value.verdict).toEqual({ value: 'approve', source: 'derived' });
  });

  it('refuses to approve over a staged blocker, but not a withdrawn one', () => {
    const blocker = createTestUraItem({ id: itemId(7), severity: 'blocker' });
    expect(compileUraArtifact(input({ items: [blocker], verdict: 'approve' }))).toEqual({
      ok: false,
      error: { kind: 'approve-with-blockers', itemIds: [itemId(7)] },
    });
    const withdrawn = createTestUraItem({ severity: 'blocker', status: { kind: 'withdrawn' } });
    expect(compileUraArtifact(input({ items: [withdrawn], verdict: 'approve' })).ok).toBe(true);
  });

  it('refuses items from another session', () => {
    const foreign = createTestUraItem({ sessionId: testUraIds.otherSessionId });
    expect(compileUraArtifact(input({ items: [foreign] }))).toEqual({
      ok: false,
      error: { kind: 'foreign-item', itemId: foreign.id },
    });
  });
});
