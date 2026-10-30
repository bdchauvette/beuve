import type { ChatPart } from './chat-message.ts';

/**
 * What a part's stream says (ADR 0072): a part starts (a text part always empty), a text part
 * grows by deltas, a part ends with its final state, or a text part the model abandoned (it was
 * written before a tool call, the port's `reset`) is discarded.
 */
export type ChatPartEvent =
  | { readonly type: 'part-start'; readonly part: ChatPart }
  | { readonly type: 'text-delta'; readonly partId: string; readonly text: string }
  | { readonly type: 'part-end'; readonly part: ChatPart }
  | { readonly type: 'part-discard'; readonly partId: string };
