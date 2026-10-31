import { applyModelEvent } from './apply-model-event.ts';
import type { StreamedParts } from './apply-model-event.ts';
import type { ChatPart } from './chat-message.ts';

/** How an answer's request ended, as far as its parts are concerned. */
export type AnswerEnding =
  /** A validated answer: it replaces the streamed text. Empty text makes no part. */
  | { readonly kind: 'text'; readonly text: string }
  /** A `/review`: one `finding` part per finding of its result, in order. */
  | { readonly kind: 'findings'; readonly count: number }
  /** Failed with main's error code: what streamed stays, then an `error` part. */
  | { readonly kind: 'error'; readonly code: string }
  /** Stopped: what streamed stays. */
  | { readonly kind: 'cancelled' };

/**
 * The parts an answer is stored with once its request ends (ADR 0072): what streamed, with
 * whatever was still open ended, then the ending's own parts. Reasoning and tool calls are kept
 * as the record of what the model did; a validated answer takes the streamed text's place (and
 * its part id, so a renderer keeps the node). Pure.
 */
export function answerPartsFrom(streamed: StreamedParts, ending: AnswerEnding): ChatPart[] {
  const { state } = applyModelEvent(streamed, { kind: 'stop' });
  let { nextId } = state;
  const newId = (): string => {
    const id = `p${String(nextId)}`;
    nextId += 1;
    return id;
  };
  switch (ending.kind) {
    case 'text': {
      const id = state.parts.findLast((part) => part.kind === 'text')?.id ?? newId();
      const kept = state.parts.filter((part) => part.kind !== 'text');
      if (ending.text === '') {
        return kept;
      }
      return [...kept, { kind: 'text', id, text: ending.text }];
    }
    case 'findings': {
      const kept = state.parts.filter((part) => part.kind !== 'text');
      return [
        ...kept,
        ...Array.from({ length: ending.count }, (_, finding): ChatPart => {
          return {
            kind: 'finding',
            id: newId(),
            finding,
          };
        }),
      ];
    }
    case 'error': {
      return [...state.parts, { kind: 'error', id: newId(), code: ending.code }];
    }
    case 'cancelled': {
      return [...state.parts];
    }
  }
}
