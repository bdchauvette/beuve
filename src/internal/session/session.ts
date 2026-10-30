import type { Brand } from '#x/brand/brand.ts';

/** A review session's id (a UUID). */
export type SessionId = Brand<string, 'SessionId'>;

/** A checkpoint's id (a UUID). */
export type CheckpointId = Brand<string, 'CheckpointId'>;

/** A full, lowercase commit id: 40 hex digits (SHA-1) or 64 (SHA-256 repositories). */
export type CommitSha = Brand<string, 'CommitSha'>;

/**
 * What is under review. `baseRef` is the branch the change merges into: for a pull request, the
 * local ref main fetches its base branch into.
 */
export type SessionSource =
  | {
      readonly kind: 'local';
      readonly repoPath: string;
      readonly baseRef: string;
      readonly headRef: string;
    }
  | {
      readonly kind: 'github-pull-request';
      readonly repoPath: string;
      readonly baseRef: string;
      /** `github.com` or a GitHub Enterprise Server hostname, lowercase. */
      readonly host: string;
      readonly owner: string;
      readonly repo: string;
      readonly number: number;
    };

/**
 * "I have reviewed the change from `baseSha` to `headSha`." `baseSha` is the fork point the
 * reviewer was shown (the merge-base of the base branch and `headSha` at the time), so a later
 * interdiff can tell author changes from a rebase onto a moved base.
 */
export interface Checkpoint {
  readonly id: CheckpointId;
  readonly sessionId: SessionId;
  readonly baseSha: CommitSha;
  readonly headSha: CommitSha;
  readonly createdAt: string;
}

/** The commits a reviewer signed off on: the diff from `baseSha` to `headSha`. */
export interface ReviewedRange {
  readonly baseSha: CommitSha;
  readonly headSha: CommitSha;
}

/** Derived from the session's checkpoints: the latest one, if any. */
export type ReviewState =
  { readonly kind: 'unreviewed' } | { readonly kind: 'reviewed'; readonly checkpoint: Checkpoint };

/** A reviewer's ongoing review of one change. Timestamps are ISO-8601 UTC. */
export interface Session {
  readonly id: SessionId;
  readonly source: SessionSource;
  readonly headSha: CommitSha;
  readonly review: ReviewState;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A session as {@link createSession} returns it, before any checkpoint. */
export type UnreviewedSession = Session & { readonly review: { readonly kind: 'unreviewed' } };

/**
 * Which commits still need review; main asks the git domain to turn this into a diff. An
 * interdiff runs from the last reviewed `{fromBaseSha, fromHeadSha}` to `toHeadSha` against the
 * base branch's current tip, which only git can resolve.
 */
export type ReviewRange =
  | { readonly kind: 'full'; readonly baseRef: string; readonly headSha: CommitSha }
  | {
      readonly kind: 'interdiff';
      readonly baseRef: string;
      readonly fromBaseSha: CommitSha;
      readonly fromHeadSha: CommitSha;
      readonly toHeadSha: CommitSha;
    }
  | { readonly kind: 'up-to-date'; readonly headSha: CommitSha };

/** Effects the pure transformations need, injected for determinism. */
export interface SessionDeps {
  readonly now: () => Date;
  readonly newId: () => string;
}

/** Expected failures of the session domain. */
export type SessionError =
  | { readonly kind: 'invalid-commit-sha'; readonly value: string }
  | { readonly kind: 'invalid-session-id'; readonly value: string }
  | { readonly kind: 'invalid-source'; readonly reason: string }
  | { readonly kind: 'session-not-found'; readonly sessionId: SessionId }
  | { readonly kind: 'duplicate-session'; readonly source: SessionSource }
  | {
      readonly kind: 'corrupt-row';
      readonly table: 'sessions' | 'checkpoints';
      readonly id: string;
      readonly reason: string;
    };
