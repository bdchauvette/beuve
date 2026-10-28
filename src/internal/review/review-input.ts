import type { CommitSha, SessionId } from './agent-insight.ts';

/**
 * What a preliminary review looks at, in the review domain's own terms. Main maps the session,
 * git and impact domains' data into it (ADR 0002 forbids importing them here).
 */
export interface ReviewInput {
  readonly sessionId: SessionId;
  readonly scope: ReviewScope;
  /** Absolute path of the session worktree, checked out at `scope.headSha`. The model may read it. */
  readonly worktreePath: string;
  /** In diff order. */
  readonly files: readonly ReviewFile[];
  /** The path prefixes the review is limited to, as `normalizePathScope` returns them; default `[]`. */
  readonly pathScope?: readonly string[];
  /** ImpactGate findings for the head, if computed. */
  readonly impactFindings?: readonly ReviewImpactFinding[];
  /** The change's stated purpose: a PR description or the coding agent's prompt. Untrusted text. */
  readonly intent?: string;
}

/**
 * `full`: the whole change from the fork point. `interdiff`: only what changed since the reviewed
 * head (`exact` when the fork point stayed, `rebased` when the reviewed changes were replayed onto
 * a new one). An interdiff that fell back to the full change is passed as `full`.
 */
export type ReviewScope =
  | { readonly kind: 'full'; readonly baseSha: CommitSha; readonly headSha: CommitSha }
  | {
      readonly kind: 'interdiff';
      readonly outcome: 'exact' | 'rebased';
      readonly baseSha: CommitSha;
      readonly fromHeadSha: CommitSha;
      readonly headSha: CommitSha;
    };

/** One file of the reviewed diff. `path` is the head-side path (the old path for deletions). */
export interface ReviewFile {
  readonly path: string;
  readonly previousPath?: string;
  readonly status: 'added' | 'deleted' | 'modified' | 'renamed' | 'copied';
  readonly binary: boolean;
  /** The file's unified diff text as git printed it (`diff --git` through its last hunk line). */
  readonly patch: string;
}

/** A changed function over the cognitive complexity limit (ImpactGate, ADR 0015). */
export interface ReviewImpactFinding {
  readonly path: string;
  readonly functionName: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly value: number;
  readonly limit: number;
  readonly trend: 'introduced' | 'worsened' | 'unchanged' | 'improved';
}
