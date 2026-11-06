import { describe } from 'vitest';

import { runMigrations } from '#sqlite/run-migrations.ts';

import { test } from './testing/test.ts';

import { findStoredBranch } from './find-stored-branch.ts';
import { githubMigrations } from './github-migrations.ts';
import { saveStoredBranch } from './save-stored-branch.ts';
import type { BranchRecord } from './save-stored-branch.ts';

function record(): BranchRecord {
  return {
    ref: { host: 'github.com', owner: 'octo-org', repo: 'hello-world', branch: 'claude/x' },
    defaultBranch: 'main',
    htmlUrl: 'https://github.com/octo-org/hello-world/tree/claude/x',
    parent: undefined,
    source: undefined,
    headSha: 'a'.repeat(40),
    state: 'present',
    pullRequest: undefined,
  };
}

function own(): BranchRecord['pullRequest'] {
  return { owner: 'octo-org', repo: 'hello-world', number: 7 };
}

describe('saveStoredBranch', () => {
  test(
    'stores, replaces and reads back a followed branch',
    { concurrent: false },
    ({ expect, db, clock }) => {
      runMigrations(db, githubMigrations);
      expect(findStoredBranch(db, record().ref)).toStrictEqual({ ok: true, value: undefined });
      clock.set('2026-11-06T12:00:00.000Z');
      saveStoredBranch(db, record());
      expect(findStoredBranch(db, record().ref)).toStrictEqual({
        ok: true,
        value: { ...record(), fetchedAt: '2026-11-06T12:00:00.000Z' },
      });
      clock.set('2026-11-06T13:00:00.000Z');
      saveStoredBranch(db, { ...record(), state: 'gone', pullRequest: own() });
      expect(findStoredBranch(db, record().ref)).toMatchObject({
        ok: true,
        value: { state: 'gone', pullRequest: own(), fetchedAt: '2026-11-06T13:00:00.000Z' },
      });
    },
  );

  test('keeps a fork’s upstreams and its pull request upstream', ({ expect, db }) => {
    runMigrations(db, githubMigrations);
    const fork: BranchRecord = {
      ...record(),
      parent: { owner: 'mid', repo: 'hello-world' },
      source: { owner: 'root', repo: 'hello' },
      pullRequest: { owner: 'root', repo: 'hello', number: 3 },
    };
    saveStoredBranch(db, fork);
    expect(findStoredBranch(db, record().ref)).toMatchObject({ ok: true, value: fork });
  });

  test('refuses a state it does not know', ({ expect, db }) => {
    runMigrations(db, githubMigrations);
    expect(() => {
      saveStoredBranch(db, { ...record(), state: 'deleted' as 'gone' });
    }).toThrow('CHECK constraint failed');
  });
});
