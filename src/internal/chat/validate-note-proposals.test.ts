import { describe } from 'vitest';

import type { ProposalRules } from './note-proposal.ts';
import type { ProposalSegment } from './parse-note-proposals.ts';
import { createChatQuestion } from './testing/create-chat-question.ts';
import { test } from './testing/test.ts';
import { validateNoteProposals } from './validate-note-proposals.ts';

/** A well-formed block on `src/a.ts`, which the fixture's hunk covers on lines 10–14. */
function block(overrides: Partial<Extract<ProposalSegment, { kind: 'block' }>>): ProposalSegment {
  return {
    kind: 'block',
    label: 'issue',
    blocking: false,
    lines: { path: 'src/a.ts', startLine: 12, endLine: 12 },
    title: 'Empty input',
    body: 'An empty string yields `undefined`.',
    ...overrides,
  };
}

function rules(maxProposals = 10): ProposalRules {
  return { labels: ['issue', 'nitpick'], maxProposals };
}

describe('validateNoteProposals', () => {
  test('keeps notes on diff lines, narrowed to the hunks, and drops the rest in place', ({
    expect,
  }) => {
    const pieces = validateNoteProposals(
      [
        { kind: 'text', text: 'Intro.' },
        block({ lines: { path: '/work/repo/src/a.ts', startLine: 8, endLine: 11 } }),
        block({ lines: { path: 'src/a.ts', startLine: 1, endLine: 3 } }),
        block({ lines: { path: 'src/elsewhere.ts', startLine: 1, endLine: 1 } }),
        block({ label: 'praise', blocking: true }),
        block({ title: '', body: '' }),
        { kind: 'malformed' },
        block({
          title: '  Second\n line  ',
          lines: { path: './src/b.ts', startLine: 2, endLine: 2 },
        }),
      ],
      createChatQuestion(),
      rules(),
    );
    expect(pieces).toStrictEqual([
      { kind: 'text', text: 'Intro.' },
      {
        kind: 'proposal',
        proposal: {
          path: 'src/a.ts',
          startLine: 10,
          endLine: 11,
          label: 'issue',
          blocking: false,
          title: 'Empty input',
          body: 'An empty string yields `undefined`.',
        },
      },
      { kind: 'dropped-proposal', reason: 'outside-diff' },
      { kind: 'dropped-proposal', reason: 'unknown-file' },
      { kind: 'dropped-proposal', reason: 'unknown-label' },
      { kind: 'dropped-proposal', reason: 'malformed' },
      { kind: 'dropped-proposal', reason: 'malformed' },
      {
        kind: 'proposal',
        proposal: {
          path: 'src/b.ts',
          startLine: 2,
          endLine: 2,
          label: 'issue',
          blocking: false,
          title: 'Second line',
          body: 'An empty string yields `undefined`.',
        },
      },
    ]);
  });

  test('drops repeats and notes beyond the limit, and cuts long titles', ({ expect }) => {
    const pieces = validateNoteProposals(
      [
        block({ title: 'x'.repeat(250) }),
        block({ title: 'EMPTY INPUT' }),
        block({}),
        block({ title: 'Other' }),
      ],
      createChatQuestion(),
      rules(2),
    );
    expect(
      pieces.map((piece) => {
        if (piece.kind === 'proposal') {
          return piece.proposal.title.length;
        }
        return piece.kind === 'dropped-proposal' && piece.reason;
      }),
    ).toStrictEqual([200, 11, 'duplicate', 'over-limit']);
  });
});
