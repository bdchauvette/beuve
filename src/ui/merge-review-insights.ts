import type { ChatFindingView, ChatMessageView } from '#contract/ipc-contract.ts';

/**
 * One `/review` finding shown on the diff (ADR 0061). `messageId` and `index` name it in its
 * answer, which is what staging needs. `sources` lists the same finding's `messageId:index` in
 * every answer that made it, this one first, so a finding staged from an older run still counts
 * as staged.
 */
export interface ReviewInsight {
  readonly key: string;
  readonly messageId: string;
  readonly index: number;
  readonly finding: ChatFindingView;
  readonly sources: readonly string[];
}

const markPattern = /[`*_]/gu;
const spacePattern = /\s+/gu;
const closingPattern = /[.!]$/u;

/**
 * The insights for the session head `headSha`, derived from the stored chat messages: completed
 * `/review` answers at that head, every scope together. The same finding in several answers (the
 * same file, overlapping head lines and the same title once normalized) appears once, from the
 * newest answer; two different problems on the same lines stay separate. Findings of one answer
 * are never merged with each other. Pure, in answer order and finding order.
 */
export function mergeReviewInsights(
  messages: readonly ChatMessageView[],
  headSha: string,
): ReviewInsight[] {
  const answers = messages
    .filter(
      (message) =>
        message.role === 'assistant' &&
        message.answerKind === 'review' &&
        message.status === 'done' &&
        message.review !== undefined &&
        message.headSha === headSha,
    )
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  const kept: Entry[] = [];
  for (const answer of answers) {
    const earlier = [...kept];
    const findings = answer.review?.findings ?? [];
    for (const [index, finding] of findings.entries()) {
      const key = `${answer.id}:${String(index)}`;
      const twin = earlier.find((entry) => isSameFinding(entry.finding, finding));
      if (twin === undefined) {
        kept.push({ key, messageId: answer.id, index, finding, sources: [key] });
      } else {
        twin.sources.push(key);
      }
    }
  }
  return kept;
}

interface Entry {
  readonly key: string;
  readonly messageId: string;
  readonly index: number;
  readonly finding: ChatFindingView;
  readonly sources: string[];
}

function isSameFinding(a: ChatFindingView, b: ChatFindingView): boolean {
  return (
    a.path === b.path &&
    a.startLine <= b.endLine &&
    b.startLine <= a.endLine &&
    normalizedTitle(a.title) === normalizedTitle(b.title)
  );
}

/** The title without case, inline-code and emphasis marks, extra spaces or a closing full stop. */
function normalizedTitle(title: string): string {
  return title
    .toLowerCase()
    .replaceAll(markPattern, '')
    .replaceAll(spacePattern, ' ')
    .trim()
    .replace(closingPattern, '');
}
