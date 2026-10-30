import { okValueFrom } from '#testing/ok-value-from.ts';

import { createSession } from './create-session.ts';
import { findSessionBySource } from './find-session-by-source.ts';
import { findSession } from './find-session.ts';
import { insertSession } from './insert-session.ts';
import { listSessions } from './list-sessions.ts';
import type { CommitSha, SessionId, SessionSource, UnreviewedSession } from './session.ts';
import { countingSessionDeps } from './testing/counting-session-deps.ts';
import { test } from './testing/test.ts';

test(
  'insertSession round-trips both kinds through findSession, findSessionBySource and listSessions',
  { concurrent: false },
  ({ expect, clock, db }) => {
    const first = make(local(), 1);
    clock.advance({ minutes: 1 });
    const second = make(pull(), 2);
    expect(insertSession(db, first)).toStrictEqual({ ok: true, value: undefined });
    expect(insertSession(db, second)).toStrictEqual({ ok: true, value: undefined });

    expect(findSession(db, first.id)).toStrictEqual({ ok: true, value: first });
    expect(findSessionBySource(db, pull())).toStrictEqual({ ok: true, value: second });
    expect(listSessions(db)).toStrictEqual({ ok: true, value: [second, first] });
  },
);

test('insertSession reports a missing session as undefined', ({ expect, db }) => {
  const missing = '00000000-0000-4000-8000-0000000000ff' as SessionId;
  expect(findSession(db, missing)).toStrictEqual({ ok: true, value: undefined });
  expect(findSessionBySource(db, local())).toStrictEqual({ ok: true, value: undefined });
  expect(findSessionBySource(db, { ...pull(), number: 8 })).toStrictEqual({
    ok: true,
    value: undefined,
  });
});

test('insertSession keeps the same pull request number on two hosts apart', ({ expect, db }) => {
  const enterprise: SessionSource = { ...pull(), host: 'ghe.example.com' };
  const first = make(pull(), 1);
  const second = make(enterprise, 2);
  expect(insertSession(db, first).ok).toBe(true);
  expect(insertSession(db, second).ok).toBe(true);
  expect(findSessionBySource(db, enterprise)).toStrictEqual({ ok: true, value: second });
  expect(findSessionBySource(db, pull())).toStrictEqual({ ok: true, value: first });
});

test('insertSession refuses a second session for the same change', ({ expect, db }) => {
  insertSession(db, make(local(), 1));
  const duplicate = make(local(), 2);
  expect(insertSession(db, duplicate)).toStrictEqual({
    ok: false,
    error: { kind: 'duplicate-session', source: local() },
  });
  const otherBranch = make({ ...local(), headRef: 'other' }, 3);
  expect(insertSession(db, otherBranch).ok).toBe(true);
});

test('insertSession throws on an id collision, which is a bug rather than an expected failure', ({
  expect,
  db,
}) => {
  insertSession(db, make(local(), 1));
  const sameId = make({ ...local(), headRef: 'other' }, 1);
  expect(() => insertSession(db, sameId)).toThrow('sessions.id');
});

function local(): LocalSource {
  return { kind: 'local', repoPath: '/repo', baseRef: 'main', headRef: 'feat' };
}

function pull(): PullRequestSource {
  return {
    kind: 'github-pull-request',
    repoPath: '/repo',
    baseRef: 'main',
    host: 'github.com',
    owner: 'acme',
    repo: 'beuve',
    number: 7,
  };
}

function make(source: SessionSource, n: number): UnreviewedSession {
  return okValueFrom(createSession(source, 'a'.repeat(40) as CommitSha, countingSessionDeps(n)));
}

type LocalSource = Extract<SessionSource, { readonly kind: 'local' }>;

type PullRequestSource = Extract<SessionSource, { readonly kind: 'github-pull-request' }>;
