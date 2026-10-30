import { describe } from 'vitest';

import { test } from './testing/test.ts';

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

function session(): SessionSummary {
  return {
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
}

function item(): UraItemView {
  return {
    id: 'u1',
    title: 'Round once, after summing',
    severity: 'issue',
    status: { kind: 'staged' },
  } as unknown as UraItemView;
}

function sources(): PaletteSources {
  return {
    commands: commandRegistry,
    platform: 'mac',
    sessions: [session()],
    files: [file('src/total.ts'), file('src/checkout.ts')],
    trackedPaths: ['README.md', 'src/checkout.ts', 'src/total.ts', 'src/util/tax-table.ts'],
    uraItems: [item()],
  };
}

describe('planPalette', () => {
  test('lists commands with their shortcuts after >', ({ expect }) => {
    const entries = planPalette('>show callers', sources());
    expect(entries[0]).toMatchObject({ title: 'Show Callers', detail: 'Review', keys: ['⌘I'] });
    expect(entries.every((entry) => entry.group === 'commands')).toBe(true);
    expect(
      planPalette('>show callers', { ...sources(), platform: 'linux' })[0]?.keys,
    ).toStrictEqual(['Ctrl+I']);
  });

  test('shows a chat command’s usage as its key', ({ expect }) => {
    const [entry] = planPalette('>clear chat…', sources());
    expect(entry?.keys).toStrictEqual(['/clear']);
  });

  test('leaves keys that work only in place out', ({ expect }) => {
    expect(planPalette('>back to the diff', sources()).map((entry) => entry.title)).not.toContain(
      'Back to the Diff',
    );
  });

  test('lists changed files first after @, then the rest of the tree', ({ expect }) => {
    expect(planPalette('@', sources()).map((entry) => entry.title)).toStrictEqual([
      'src/total.ts',
      'src/checkout.ts',
      'README.md',
      'src/util/tax-table.ts',
    ]);
    expect(planPalette('@tax', sources())[0]?.action).toStrictEqual({
      kind: 'file',
      path: 'src/util/tax-table.ts',
      isChanged: false,
    });
  });

  test('offers a pasted pull request first, in its known clone', ({ expect }) => {
    const [entry] = planPalette('octo-org/hello#9', sources());
    expect(entry).toMatchObject({
      title: 'Open octo-org/hello#9',
      action: { kind: 'open-pull', ref: 'octo-org/hello#9', repoPath: '/code/hello' },
    });
  });

  test('lists recent sessions and the open steps after #', ({ expect }) => {
    expect(planPalette('#', sources()).map((entry) => entry.title)).toStrictEqual([
      '#7 Add tax to totals',
      'Open pull request…',
      'Open local branch…',
    ]);
  });

  test('finds staged items by title after !', ({ expect }) => {
    expect(planPalette('!round', sources())[0]?.action).toStrictEqual({
      kind: 'ura-item',
      itemId: 'u1',
    });
  });

  test('mixes a few of each group without a prefix, in group order', ({ expect }) => {
    const groups = planPalette('tax', sources()).map((entry) => entry.group);
    expect(groups).toStrictEqual(groups.toSorted((a, b) => order(a) - order(b)));
    expect(groups).toContain('open');
    expect(groups).toContain('files');
  });
});

function order(group: string): number {
  return ['open', 'files', 'review', 'commands'].indexOf(group);
}
