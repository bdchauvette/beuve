import type { ChatMention, CommitSha, SessionId } from './chat-message.ts';

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
  /** The reviewer's question, as typed; unused for a {@link ChatTask}. */
  readonly question: string;
  /**
   * A command's fixed task instead of a question: `/review` (findings through the structured
   * output, ADR 0055) or `/summarize` (beuve's own summary of the change, ADR 0056).
   */
  readonly task?: ChatTask;
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
  /**
   * The lines the reviewer attached to this question (ADR 0046), resolved at their commits, in
   * `[[@n]]` order. The prompt puts them first and gives them the budget before the diff.
   */
  readonly selections?: readonly ChatSelection[];
  /** The latest `/compact` summary (ADR 0047); `history` then holds only the turns after it. */
  readonly summary?: string;
  /** Earlier turns of this session's transcript, oldest first (see `toChatHistory`). */
  readonly history?: readonly ChatTurn[];
  /**
   * Repository-relative paths that exist at the head (e.g. `git ls-files`), so answers may cite
   * files outside the diff. The diff's head-side paths are always citable.
   */
  readonly worktreePaths?: ReadonlySet<string>;
}

/** What a chat command asks the model to do instead of answering a question. */
export type ChatTask =
  | {
      readonly kind: 'review';
      /** The normalized path prefixes the diff was limited to; `[]` is the whole change. */
      readonly pathScope: readonly string[];
      readonly maxFindings: number;
    }
  | { readonly kind: 'abstract' };

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

/** A mention resolved to the text it names at its commit (ADR 0046). */
export type ChatSelection = Omit<ChatMention, 'startLine' | 'endLine'> &
  (
    | {
        readonly kind: 'lines';
        readonly startLine: number;
        /** Clamped to the file's last line. */
        readonly endLine: number;
        readonly totalLines: number;
        readonly isWholeFile: boolean;
        /** The selected lines, without their line terminators. Untrusted. */
        readonly lines: readonly string[];
      }
    | { readonly kind: 'unreadable'; readonly reason: 'binary' | 'too-large' | 'submodule' }
  );

/** An earlier question or answer, as plain Markdown. A question's `[[@n]]` name its `mentions`. */
export interface ChatTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly mentions?: readonly ChatMention[];
}
