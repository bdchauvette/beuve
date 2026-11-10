import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { describeDroppedProposal } from './describe-dropped-proposal.ts';

describe('describeDroppedProposal', () => {
  test('says why a proposed note was left out', ({ expect }) => {
    expect(describeDroppedProposal('outside-diff')).toBe(
      'A proposed note was left out: its lines are outside the diff’s hunks.',
    );
    expect(describeDroppedProposal('unknown-label')).toBe(
      'A proposed note was left out: its label is not a note label.',
    );
  });
});
