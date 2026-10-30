import type { ChatFocusRequest, ImpactFindingView } from '#contract/ipc-contract.ts';
import type { DiffFile } from '#internal/git/diff-model.ts';
import type {
  ChatFile,
  ChatFocus,
  ChatQuestion,
  ChatSelection,
  ChatTask,
  ChatTurn,
} from '#internal/chat/chat-question.ts';

import type { ReviewDiff } from '../sessions/load-review-diff.ts';

export interface ChatQuestionParts {
  /** The diff `session:get-review` shows. */
  readonly diff: ReviewDiff;
  readonly worktreePath: string;
  readonly question: string;
  /** `/review` or `/summarize` instead of a question (ADR 0055, 0056). */
  readonly task?: ChatTask;
  readonly history: readonly ChatTurn[];
  /** The latest `/compact` summary, which stands for the turns before `history` (ADR 0047). */
  readonly summary?: string | undefined;
  /** The question's mentions, read at their commits (ADR 0046). */
  readonly selections?: readonly ChatSelection[];
  readonly focus: ChatFocusRequest | undefined;
  /** The cached ImpactGate findings for the same diff, if they were computed. */
  readonly impactFindings: readonly ImpactFindingView[] | undefined;
  /** The change's stated intent (a pull request's title and body), if it has one. */
  readonly intent?: string | undefined;
  /** Paths tracked at the head, so answers may cite files outside the diff. */
  readonly worktreePaths: ReadonlySet<string> | undefined;
}

/**
 * Maps the session and git domains' review diff, and ImpactGate's findings, into the chat
 * domain's input (ADR 0031). A review task's path scope limits the files (a prefix matches that
 * path and everything below it, on either side of a rename) and the findings with them; anything
 * else sees the whole diff.
 */
export function toChatQuestion(parts: ChatQuestionParts): ChatQuestion {
  const { diff } = parts;
  const prefixes = parts.task?.kind === 'review' ? parts.task.pathScope : [];
  const files = diff.files
    .map((file) => toChatFile(file))
    .filter((file) => isSelected(file, prefixes));
  const paths = new Set(files.map((file) => file.path));
  const findings = parts.impactFindings
    ?.filter((finding) => paths.has(finding.path))
    .map(({ path, functionName, startLine, endLine, value, limit, trend }) => ({
      path,
      functionName,
      startLine,
      endLine,
      value,
      limit,
      trend,
    }));
  return {
    sessionId: diff.refreshed.session.id,
    baseSha: diff.baseSha,
    headSha: diff.refreshed.session.headSha,
    worktreePath: parts.worktreePath,
    question: parts.question,
    files,
    history: parts.history,
    ...(parts.task !== undefined && { task: parts.task }),
    ...(parts.summary !== undefined && { summary: parts.summary }),
    ...(parts.selections !== undefined &&
      parts.selections.length > 0 && { selections: parts.selections }),
    ...(findings !== undefined && { impactFindings: findings }),
    ...(parts.intent !== undefined && parts.intent.trim() !== '' && { intent: parts.intent }),
    ...(parts.focus !== undefined && { focus: toFocus(parts.focus) }),
    ...(parts.worktreePaths !== undefined && { worktreePaths: parts.worktreePaths }),
  };
}

function toChatFile(file: DiffFile): ChatFile {
  const common = { binary: file.binary, patch: file.patch };
  switch (file.status) {
    case 'added':
    case 'deleted':
    case 'modified': {
      return { path: file.path, status: file.status, ...common };
    }
    case 'renamed':
    case 'copied': {
      return { path: file.newPath, previousPath: file.oldPath, status: file.status, ...common };
    }
  }
}

function isSelected(file: ChatFile, prefixes: readonly string[]): boolean {
  if (prefixes.length === 0) {
    return true;
  }
  const candidates = [file.path, file.previousPath].filter((path) => path !== undefined);
  return prefixes.some((prefix) =>
    candidates.some((path) => path === prefix || path.startsWith(`${prefix}/`)),
  );
}

function toFocus(focus: ChatFocusRequest): ChatFocus {
  return {
    path: focus.path,
    ...(focus.line !== undefined && { startLine: focus.line, endLine: focus.line }),
  };
}
