import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import type { CommitInfoView } from '#contract/ipc-contract.ts';

import '../primitives/beuve-commit.ts';
import { framed } from './framed.ts';

const meta: Meta = { title: 'Primitives/Commit hash' };

export default meta;

/** Hover or focus the hash to see its card. */
export const Commit: StoryObj = {
  render: () => {
    return framed(
      html`Reviewing
        <beuve-commit sha=${sample().sha} hint="Click to open on GitHub"></beuve-commit> and
        <beuve-commit sha=${'0'.repeat(40)}></beuve-commit> (not in this clone)`,
      [sample()],
    );
  },
};

function sample(): CommitInfoView {
  const at = Temporal.Now.instant().subtract({ hours: 3 }).toString();
  return {
    sha: '3f3333e1c2b4a5d6e7f8091a2b3c4d5e6f708192',
    parents: ['24d2c8e7a1b2c3d4e5f60718293a4b5c6d7e8f90'],
    author: { name: 'Ada Lovelace', email: 'ada@example.com', at },
    committer: { name: 'Ada Lovelace', email: 'ada@example.com', at },
    subject: 'Tidy the order totals',
    body: 'Skip blank and malformed lines, and keep the rest.\n\nThe parser now returns a Result.',
  };
}
