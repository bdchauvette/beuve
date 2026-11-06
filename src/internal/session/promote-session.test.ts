import type { DatabaseSync } from 'node:sqlite';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { createSession } from './create-session.ts';
import { findSession } from './find-session.ts';
import { findSessionBySource } from './find-session-by-source.ts';
import { insertCheckpoint } from './insert-checkpoint.ts';
import { insertSession } from './insert-session.ts';
import { promoteSession } from './promote-session.ts';
import type { Promotion } from './promote-session.ts';
import { recordCheckpoint } from './record-checkpoint.ts';
import type { CommitSha, Session, SessionDeps, SessionSource } from './session.ts';
import { test } from './testing/test.ts';

test('promoteSession turns a remote branch into its pull request, keeping the id and the review', ({
  expect,
  db,
  deps,
}) => {
  const session = stored(db, deps, branch());
  const { checkpoint } = recordCheckpoint(session, { baseSha: sha('b'), headSha: sha('a') }, deps);
  okValueFrom(insertCheckpoint(db, checkpoint));

  const promoted = okValueFrom(
    promoteSession(db, { session, ...acme(), number: 12, baseRef: 'refs/beuve/pr/12/base' }),
  );

  expect(promoted.id).toBe(session.id);
  expect(promoted.source).toStrictEqual(pull(12));
  expect(okValueFrom(findSession(db, session.id))).toMatchObject({
    id: session.id,
    source: pull(12),
    review: { kind: 'reviewed', checkpoint: { id: checkpoint.id } },
  });
  const byBranch = findSessionBySource(db, branch());
  const byPull = findSessionBySource(db, pull(12));
  expect(okValueFrom(byBranch)).toBeUndefined();
  expect(okValueFrom(byPull)?.id).toBe(session.id);
});

test('promoteSession leaves both sessions alone when the pull request already has one', ({
  expect,
  db,
  deps,
}) => {
  const existing = stored(db, deps, pull(12));
  const session = stored(db, deps, branch());
  expect(
    promoteSession(db, { session, ...acme(), number: 12, baseRef: 'refs/beuve/pr/12/base' }),
  ).toMatchObject({ ok: false, error: { kind: 'duplicate-session', source: pull(12) } });
  expect(okValueFrom(findSession(db, session.id))?.source).toStrictEqual(branch());
  expect(okValueFrom(findSession(db, existing.id))?.source).toStrictEqual(pull(12));
});

test.for<[string, (session: Session) => Session]>([
  ['a pull request session', (session): Session => session],
  [
    'a remote branch promoted meanwhile',
    (session): Session => {
      return { ...session, source: branch() };
    },
  ],
])('promoteSession refuses %s', ([, as], { expect, db, deps }) => {
  const session = as(stored(db, deps, pull(3)));
  expect(
    promoteSession(db, { session, ...acme(), number: 4, baseRef: 'refs/beuve/pr/4/base' }),
  ).toMatchObject({ ok: false, error: { kind: 'not-a-remote-branch', sessionId: session.id } });
});

test('promoteSession moves a fork’s branch to the upstream pull request it opened', ({
  expect,
  db,
  deps,
}) => {
  const session = stored(db, deps, branch('forker'));
  const promoted = okValueFrom(
    promoteSession(db, { session, ...acme(), number: 12, baseRef: 'refs/beuve/pr/12/base' }),
  );
  expect(promoted.source).toStrictEqual(pull(12));
  const found = okValueFrom(findSessionBySource(db, pull(12)));
  expect(found?.id).toBe(session.id);
});

test('promoteSession refuses a non-positive pull request number', ({ expect, db, deps }) => {
  const session = stored(db, deps, branch());
  expect(
    promoteSession(db, { session, ...acme(), number: 0, baseRef: 'refs/beuve/pr/0/base' }),
  ).toMatchObject({ ok: false, error: { kind: 'invalid-source' } });
});

/** The pull requests' base repository, the branch's own unless a test says otherwise. */
function acme(): Pick<Promotion, 'owner' | 'repo'> {
  return { owner: 'acme', repo: 'beuve' };
}

function stored(db: DatabaseSync, deps: SessionDeps, source: SessionSource): Session {
  const session = okValueFrom(createSession(source, sha('a'), deps));
  okValueFrom(insertSession(db, session));
  return session;
}

/** A followed branch of `owner/beuve`: `acme`'s own, or a fork's. */
function branch(owner = 'acme'): SessionSource {
  return {
    kind: 'remote-branch',
    repoPath: '/repo',
    baseRef: 'refs/beuve/branch/0123/base',
    forge: 'github',
    host: 'github.com',
    owner,
    repo: 'beuve',
    branch: 'claude/fix',
  };
}

function pull(number: number): SessionSource {
  return {
    kind: 'github-pull-request',
    repoPath: '/repo',
    baseRef: `refs/beuve/pr/${String(number)}/base`,
    host: 'github.com',
    owner: 'acme',
    repo: 'beuve',
    number,
  };
}

function sha(digit: string): CommitSha {
  return digit.repeat(40) as CommitSha;
}
