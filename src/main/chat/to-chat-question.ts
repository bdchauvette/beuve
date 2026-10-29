import type { ChatFocusRequest, ImpactFindingView } from '#contract/ipc-contract.ts';
import type {
  ChatFocus,
  ChatQuestion,
  ChatSelection,
  ChatTurn,
} from '#internal/chat/chat-question.ts';

import type { ReviewDiff } from '../sessions/load-review-diff.ts';
import { toReviewInput } from '../review/to-review-input.ts';

export interface ChatQuestionParts {
  /** The diff `session:get-review` shows. */
  readonly diff: ReviewDiff;
  readonly worktreePath: string;
  readonly question: string;
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
 * domain's input (ADR 0031). The files and findings are the review input's: the whole diff, since
 * a question isn't limited to a path scope.
 */
export function toChatQuestion(parts: ChatQuestionParts): ChatQuestion {
  const { diff } = parts;
  const input = toReviewInput({
    diff,
    worktreePath: parts.worktreePath,
    pathPrefixes: [],
    impactFindings: parts.impactFindings,
  });
  return {
    sessionId: diff.refreshed.session.id,
    baseSha: diff.baseSha,
    headSha: diff.refreshed.session.headSha,
    worktreePath: parts.worktreePath,
    question: parts.question,
    files: input.files,
    history: parts.history,
    ...(parts.summary !== undefined && { summary: parts.summary }),
    ...(parts.selections !== undefined &&
      parts.selections.length > 0 && { selections: parts.selections }),
    ...(input.impactFindings !== undefined && { impactFindings: input.impactFindings }),
    ...(parts.intent !== undefined && parts.intent.trim() !== '' && { intent: parts.intent }),
    ...(parts.focus !== undefined && { focus: toFocus(parts.focus) }),
    ...(parts.worktreePaths !== undefined && { worktreePaths: parts.worktreePaths }),
  };
}

function toFocus(focus: ChatFocusRequest): ChatFocus {
  return {
    path: focus.path,
    ...(focus.line !== undefined && { startLine: focus.line, endLine: focus.line }),
  };
}
