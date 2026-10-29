import type { ChatMentionView } from '#contract/ipc-contract.ts';

import type { DraftPart } from './chat-draft.ts';

/** A question as `chat:ask` takes it. */
export interface SerializedDraft {
  /** Trimmed; each chip is `[[@n]]`, naming the n-th of `mentions`. */
  readonly text: string;
  readonly mentions: readonly ChatMentionView[];
}

const typedToken = /\[\[@/gu;

/**
 * Turns the input's parts into the question text and its mentions (ADR 0046). The same mention
 * twice is one mention named twice. Typed text that looks like a token (`[[@`) gets a space
 * (`[[ @`), so only chips become mentions. Pure.
 */
export function serializeChatDraft(parts: readonly DraftPart[]): SerializedDraft {
  const mentions: ChatMentionView[] = [];
  const keys: string[] = [];
  let text = '';
  for (const part of parts) {
    if (part.kind === 'text') {
      text += part.text.replaceAll(typedToken, '[[ @');
      continue;
    }
    const { path, side, startLine, endLine, sha } = part.mention;
    const key = [path, side, startLine ?? '', endLine ?? '', sha].join('\0');
    let index = keys.indexOf(key);
    if (index === -1) {
      index = mentions.length;
      mentions.push(part.mention);
      keys.push(key);
    }
    text += `[[@${String(index + 1)}]]`;
  }
  return { text: text.trim(), mentions };
}
