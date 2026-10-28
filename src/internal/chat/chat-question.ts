import type { CommitSha, SessionId } from './chat-message.ts';

/**
 * One question about a reviewed change, in the chat domain's own terms. Main maps the session,
 * git, impact and review domains' data into it (ADR 0002 forbids importing them here).
 */
export interface ChatQuestion {
  readonly sessionId: SessionId;
  /** The reviewed change: from `baseSha` (the fork point) to `headSha`. */
  readonly baseSha: CommitSha;
  readonly headSha: CommitSha;
  /** Absolute path of the session worktree, checked out at `headSha`. The model may read it. */
  readonly worktreePath: string;
  /** The reviewer's question, as typed. */
  readonly question: string;
  /**
   * What the change's author says it is for (a pull request's title and body). Untrusted text,
   * shown to the model as context and bounded by the prompt budget.
   */
  readonly intent?: string;
  /** The reviewed diff, in diff order. */
  readonly files: readonly ChatFile[];
  /** ImpactGate findings for the head, if computed. */
  readonly impactFindings?: readonly ChatImpactFinding[];
  /** What the reviewer is looking at in the diff stream, if anything. */
  readonly focus?: ChatFocus;
  /** Earlier turns of this session's transcript, oldest first (see `toChatHistory`). */
  readonly history?: readonly ChatTurn[];
  /**
   * Repository-relative paths that exist at the head (e.g. `git ls-files`), so answers may cite
   * files outside the diff. The diff's head-side paths are always citable.
   */
  readonly worktreePaths?: ReadonlySet<string>;
}

/** One file of the reviewed diff. `path` is the head-side path (the old path for deletions). */
export interface ChatFile {
  readonly path: string;
  readonly previousPath?: string;
  readonly status: 'added' | 'deleted' | 'modified' | 'renamed' | 'copied';
  readonly binary: boolean;
  /** The file's unified diff text as git printed it. */
  readonly patch: string;
}

/** A changed function over the cognitive complexity limit (ImpactGate, ADR 0015). */
export interface ChatImpactFinding {
  readonly path: string;
  readonly functionName: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly value: number;
  readonly limit: number;
  readonly trend: 'introduced' | 'worsened' | 'unchanged' | 'improved';
}

/** The file, and optionally the head-side lines and hunk text, the reviewer has focused. */
export interface ChatFocus {
  readonly path: string;
  readonly startLine?: number;
  readonly endLine?: number;
  /** The focused hunk's diff text. Untrusted. */
  readonly excerpt?: string;
}

/** An earlier question or answer, as plain Markdown. */
export interface ChatTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}
