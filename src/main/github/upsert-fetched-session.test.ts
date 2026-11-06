import { describe } from 'vitest';

import type { CommitSha } from '#internal/session/session.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import { createGitCaches } from '../sessions/create-git-caches.ts';
import { loadSession } from '../sessions/load-session.ts';
import type { SessionContext } from '../sessions/session-context.ts';
import { test } from '../testing/test.ts';
import { moveSessionHead } from './move-session-head.ts';
import { upsertFetchedSession } from './upsert-fetched-session.ts';
import type { FetchedHead } from './upsert-fetched-session.ts';

describe('upsertFetchedSession', () => {
  test('a slower open that finishes last does not move the head back (ADR 0079)', ({
    expect,
    db,
    deps,
    logger,
  }) => {
    const moves: string[] = [];
    const context: SessionContext = {
      db,
      deps,
      logger: logger.logger,
      git: {},
      caches: createGitCaches(),
      onHeadMoved: (_, headSha) => {
        moves.push(headSha);
      },
    };
    const source = pullRequest();
    const opened = okValueFrom(
      upsertFetchedSession(context, { source, headSha: sha('1'), observedFrom: undefined }),
    );
    const observedFrom = okValueFrom(loadSession(context, opened.id));
    okValueFrom(moveSessionHead(context, observedFrom, sha('3')));
    const reopened = okValueFrom(
      upsertFetchedSession(context, { source, headSha: sha('2'), observedFrom }),
    );
    expect(reopened.headSha).toBe(sha('3'));
    expect(okValueFrom(loadSession(context, opened.id)).headSha).toBe(sha('3'));
    expect(moves).toStrictEqual([sha('3')]);
  });

  test('an open that saw the stored head moves it', ({ expect, db, deps, logger }) => {
    const context: SessionContext = {
      db,
      deps,
      logger: logger.logger,
      git: {},
      caches: createGitCaches(),
    };
    const source = pullRequest();
    const opened = okValueFrom(
      upsertFetchedSession(context, { source, headSha: sha('1'), observedFrom: undefined }),
    );
    const observedFrom = okValueFrom(loadSession(context, opened.id));
    const moved = upsertFetchedSession(context, { source, headSha: sha('2'), observedFrom });
    expect(okValueFrom(moved).headSha).toBe(sha('2'));
  });
});

function pullRequest(): FetchedHead['source'] {
  return {
    kind: 'github-pull-request',
    repoPath: '/repo',
    baseRef: 'refs/beuve/pr/7/base',
    host: 'github.com',
    owner: 'octo-org',
    repo: 'hello-world',
    number: 7,
  };
}

function sha(digit: string): CommitSha {
  return digit.repeat(40) as CommitSha;
}
