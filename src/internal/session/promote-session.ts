import type { DatabaseSync } from 'node:sqlite';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';
import { sqliteErrorCode } from '#sqlite/sqlite-error-code.ts';

import { parseSessionSource } from './parse-session-source.ts';
import type { Session, SessionError, SessionId, SessionSource } from './session.ts';

/** Why {@link promoteSession} changed nothing. */
export type PromoteError =
  | Extract<SessionError, { kind: 'duplicate-session' | 'invalid-source' }>
  /** The stored row is not a remote branch (any more), or is gone. */
  | { readonly kind: 'not-a-remote-branch'; readonly sessionId: SessionId };

/** A remote-branch session, and the pull request now open for its branch. */
export interface Promotion {
  readonly session: Session;
  /**
   * The pull request's base repository: the branch's own, or an upstream of the fork the branch
   * is in (ADR 0112 amendment). Same host.
   */
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  /** The local ref the pull request's base branch is fetched into. */
  readonly baseRef: string;
}

const uniqueViolation = 2067;

/**
 * Turns a remote-branch session into the session of the pull request opened for its branch, in
 * place (ADR 0112): the id, and so every checkpoint, file mark and item hanging off it, stays.
 * The clone and host are kept; the owner and name become the pull request's base repository,
 * which differs from the branch's when the branch is in a fork. Only a row still of kind
 * `remote-branch` is changed. A pull request session that already exists for the same clone wins: the answer is
 * `duplicate-session` and nothing changes.
 */
export function promoteSession(
  db: DatabaseSync,
  { session, owner, repo, number, baseRef }: Promotion,
): Result<Session, PromoteError> {
  const { source } = session;
  if (source.kind !== 'remote-branch') {
    return err({ kind: 'not-a-remote-branch', sessionId: session.id });
  }
  const target: SessionSource = {
    kind: 'github-pull-request',
    repoPath: source.repoPath,
    baseRef,
    host: source.host,
    owner,
    repo,
    number,
  };
  const valid = parseSessionSource(target);
  if (!valid.ok) {
    return valid;
  }
  const updatedAt = Temporal.Now.instant().toString({ fractionalSecondDigits: 3 });
  let changes: number | bigint;
  try {
    ({ changes } = db
      .prepare(
        `UPDATE sessions
            SET kind = 'github-pull-request', base_ref = ?, owner = ?, repo = ?, pr_number = ?,
                forge = NULL, branch = NULL, updated_at = ?
          WHERE id = ? AND kind = 'remote-branch';`,
      )
      .run(baseRef, owner, repo, number, updatedAt, session.id));
  } catch (error: unknown) {
    if (sqliteErrorCode(error) === uniqueViolation) {
      return err({ kind: 'duplicate-session', source: valid.value });
    }
    throw error;
  }
  if (Number(changes) === 0) {
    return err({ kind: 'not-a-remote-branch', sessionId: session.id });
  }
  return ok({ ...session, source: valid.value, updatedAt });
}
