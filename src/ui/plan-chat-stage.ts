import type { UraAnchorView } from '#contract/ipc-contract.ts';

import type { ChatEntry } from './chat-entry.ts';
import { chatTextFrom } from './chat-text-from.ts';
import { citationMarker } from './citation-marker.ts';

/** The URA note an answer becomes when the reviewer stages it (spec Zone 4, ADR 0023). */
export interface ChatStagePlan {
  readonly messageId: string;
  /** The head the question was asked at, so the note is anchored to what the reviewer saw. */
  readonly headSha: string;
  readonly anchor: UraAnchorView;
  readonly severity: 'question';
  readonly title: string;
  readonly body: string;
}

const titleLength = 100;
const whitespace = /\s+/gu;

/**
 * Plans staging a completed answer: the first citation inside the reviewed diff anchors it (the
 * whole change when none is), the title is the question (a `/summarize` answer is titled as the
 * summary it is, ADR 0056), and the body is the answer with its markers written as
 * `path:start-end` in code. Citations outside the diff stay in the body but can't anchor a note
 * the exporters place on diff lines. `undefined` for anything but a completed, non-empty answer,
 * and for `/review` answers, whose findings stage one by one (ADR 0055).
 */
export function planChatStage(
  entries: readonly ChatEntry[],
  messageId: string,
  diffPaths: ReadonlySet<string>,
): ChatStagePlan | undefined {
  const index = entries.findIndex((entry) => entry.kind === 'message' && entry.id === messageId);
  const entry = entries[index];
  if (entry?.kind !== 'message') {
    return undefined;
  }
  const { message } = entry;
  if (
    message.role !== 'assistant' ||
    message.status !== 'done' ||
    message.answerKind === 'review' ||
    chatTextFrom(message.parts).trim() === ''
  ) {
    return undefined;
  }
  const anchored = message.citations.find((citation) => diffPaths.has(citation.path));
  let body = chatTextFrom(message.parts).trim();
  for (const citation of message.citations) {
    const code = `\`${citation.path}:${String(citation.startLine)}-${String(citation.endLine)}\``;
    body = body.replaceAll(citationMarker(citation), () => code);
  }
  return {
    messageId,
    headSha: message.headSha,
    anchor:
      anchored === undefined
        ? { kind: 'change' }
        : {
            kind: 'lines',
            path: anchored.path,
            startLine: anchored.startLine,
            endLine: anchored.endLine,
          },
    severity: 'question',
    title:
      message.answerKind === 'abstract'
        ? 'Summary of the change (beuve, from the diff)'
        : titleOf(precedingQuestion(entries.slice(0, index))),
    body,
  };
}

function precedingQuestion(before: readonly ChatEntry[]): string {
  const asked = before.findLast(
    (entry) => entry.kind === 'message' && entry.message.role === 'user',
  );
  return asked?.kind === 'message' ? chatTextFrom(asked.message.parts) : '';
}

function titleOf(question: string): string {
  const text = question.replaceAll(whitespace, ' ').trim();
  if (text === '') {
    return 'Question from the chat';
  }
  return text.length > titleLength ? `${text.slice(0, titleLength - 1).trimEnd()}…` : text;
}
