import { describe, expect, it } from 'vitest';

import type { ModelFinding } from './finding-output-schema.ts';
import { createChatQuestion } from './testing/create-chat-question.ts';
import { validateFindings } from './validate-findings.ts';

const limits = { maxFindings: 10, minConfidence: 0.3 };

function finding(overrides: Partial<ModelFinding>): ModelFinding {
  return {
    path: 'src/a.ts',
    startLine: 12,
    endLine: 12,
    severity: 'warning',
    category: 'edge-case',
    title: 'Empty input',
    body: 'An empty string yields `undefined`.',
    confidence: 0.8,
    ...overrides,
  };
}

describe('validateFindings', () => {
  it('keeps findings on diff lines and drops those outside the diff or its files', () => {
    const input = createChatQuestion({
      files: [
        ...createChatQuestion().files,
        {
          path: 'src/gone.ts',
          status: 'deleted',
          binary: false,
          patch: '@@ -1,2 +0,0 @@\n-a\n-b\n',
        },
      ],
    });
    const result = validateFindings(
      [
        finding({}),
        finding({ path: 'src/a.ts', startLine: 1, endLine: 3, title: 'Before the hunk' }),
        finding({ path: 'src/elsewhere.ts', title: 'Not in the diff' }),
        finding({ path: 'src/gone.ts', startLine: 1, endLine: 1, title: 'Deleted file' }),
        finding({ path: '/etc/passwd', title: 'Outside the worktree' }),
        finding({ path: './src/b.ts', startLine: 2, endLine: 2, title: 'Dot slash' }),
        finding({ path: '/work/repo/src/b.ts', startLine: 3, endLine: 3, title: 'Absolute' }),
      ],
      input,
      limits,
    );
    expect(result.findings.map((kept) => [kept.path, kept.startLine, kept.title])).toEqual([
      ['src/a.ts', 12, 'Empty input'],
      ['src/b.ts', 2, 'Dot slash'],
      ['src/b.ts', 3, 'Absolute'],
    ]);
    expect(result.dropped).toEqual({
      unknownFile: 3,
      outsideDiff: 1,
      lowConfidence: 0,
      duplicate: 0,
      overLimit: 0,
    });
  });

  it('narrows ranges to the touched hunks and orders reversed ranges', () => {
    const result = validateFindings(
      [finding({ startLine: 30, endLine: 8 })],
      createChatQuestion(),
      limits,
    );
    expect(result.findings[0]).toMatchObject({ startLine: 10, endLine: 14 });
    expect(result.clamped).toBe(1);
  });

  it('normalizes text and drops duplicates and low-confidence findings', () => {
    const result = validateFindings(
      [
        finding({ title: '  Empty\n input ', body: '  body  ' }),
        finding({ title: 'empty input' }),
        finding({ title: 'Unsure', confidence: 0.1 }),
      ],
      createChatQuestion(),
      limits,
    );
    expect(result.findings).toEqual([finding({ title: 'Empty input', body: 'body' })]);
    expect(result.dropped).toMatchObject({ duplicate: 1, lowConfidence: 1 });
  });

  it('keeps the most severe and confident findings within the limit, in diff order', () => {
    const result = validateFindings(
      [
        finding({ path: 'src/b.ts', startLine: 1, endLine: 1, title: 'B info', severity: 'info' }),
        finding({ path: 'src/b.ts', startLine: 2, endLine: 2, title: 'B risk', severity: 'risk' }),
        finding({ title: 'A warning sure', confidence: 0.9 }),
        finding({ title: 'A warning unsure', confidence: 0.5 }),
      ],
      createChatQuestion(),
      { maxFindings: 2, minConfidence: 0 },
    );
    expect(result.findings.map((kept) => kept.title)).toEqual(['A warning sure', 'B risk']);
    expect(result.dropped.overLimit).toBe(2);
  });
});
