import { describe, expect, it } from 'vitest';

import type { DiffFileView, SessionSummary, UraItemView } from '#contract/ipc-contract.ts';

import { commandRegistry } from './command-registry.ts';
import { planPalette } from './plan-palette.ts';
import type { PaletteSources } from './plan-palette.ts';

function file(path: string): DiffFileView {
  return {
    status: 'modified',
    path,
    additions: 2,
    deletions: 1,
    binary: false,
    hunks: [],
    patch: '',
  };
}

const session: SessionSummary = {
  id: 's1',
  source: {
    kind: 'github-pull-request',
    repoPath: '/code/hello',
    baseRef: 'refs/beuve/pr/7/base',
    host: 'github.com',
    owner: 'octo-org',
    repo: 'hello',
    number: 7,
  },
  headSha: 'a'.repeat(40),
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-02T00:00:00Z',
  pullRequest: { title: 'Add tax to totals', state: 'open', isDraft: false, baseBranch: 'main' },
};

const item = {
  id: 'u1',
  title: 'Round once, after summing',
  severity: 'issue',
  status: { kind: 'staged' },
} as unknown as UraItemView;

const sources: PaletteSources = {
  commands: commandRegistry,
  sessions: [session],
  files: [file('src/total.ts'), file('src/checkout.ts')],
  trackedPaths: ['README.md', 'src/checkout.ts', 'src/total.ts', 'src/util/tax-table.ts'],
  uraItems: [item],
};

describe('planPalette', () => {
  it('lists commands with their shortcuts after >', () => {
    const entries = planPalette('>peek', sources);
    expect(entries[0]).toMatchObject({ title: 'Call-stack peek (callers)', keys: ['p'] });
    expect(entries.every((entry) => entry.group === 'commands')).toBe(true);
  });

  it('shows a chat command’s usage as its key', () => {
    const [entry] = planPalette('>clear chat', sources);
    expect(entry?.keys).toEqual(['/clear']);
  });

  it('leaves unbuilt commands out', () => {
    expect(planPalette('>inline edit', sources).map((entry) => entry.title)).not.toContain(
      'Inline edit',
    );
  });

  it('lists changed files first after @, then the rest of the tree', () => {
    expect(planPalette('@', sources).map((entry) => entry.title)).toEqual([
      'src/total.ts',
      'src/checkout.ts',
      'README.md',
      'src/util/tax-table.ts',
    ]);
    expect(planPalette('@tax', sources)[0]?.action).toEqual({
      kind: 'file',
      path: 'src/util/tax-table.ts',
      isChanged: false,
    });
  });

  it('offers a pasted pull request first, in its known clone', () => {
    const [entry] = planPalette('octo-org/hello#9', sources);
    expect(entry).toMatchObject({
      title: 'Open octo-org/hello#9',
      action: { kind: 'open-pull', ref: 'octo-org/hello#9', repoPath: '/code/hello' },
    });
  });

  it('lists recent sessions and the open steps after #', () => {
    expect(planPalette('#', sources).map((entry) => entry.title)).toEqual([
      '#7 Add tax to totals',
      'Open pull request…',
      'Open local branch…',
    ]);
  });

  it('finds staged items by title after !', () => {
    expect(planPalette('!round', sources)[0]?.action).toEqual({ kind: 'ura-item', itemId: 'u1' });
  });

  it('mixes a few of each group without a prefix, in group order', () => {
    const groups = planPalette('tax', sources).map((entry) => entry.group);
    expect(groups).toEqual(groups.toSorted((a, b) => order(a) - order(b)));
    expect(groups).toContain('open');
    expect(groups).toContain('files');
  });
});

function order(group: string): number {
  return ['open', 'files', 'review', 'commands'].indexOf(group);
}
