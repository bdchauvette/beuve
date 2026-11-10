import { applyModelEvent } from './apply-model-event.ts';
import type { StreamedParts } from './apply-model-event.ts';
import type { ChatPart } from './chat-message.ts';
import type { AnswerPiece } from './note-proposal.ts';

/** How an answer's request ended, as far as its parts are concerned. */
export type AnswerEnding =
  /**
   * A validated answer, with its proposed notes in place (ADR 0132): its pieces replace the
   * streamed text, the first text piece keeping the streamed text's part id. Empty text makes no
   * part.
   */
  | { readonly kind: 'answer'; readonly pieces: readonly AnswerPiece[] }
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
    case 'answer': {
      let streamedId = state.parts.findLast((part) => part.kind === 'text')?.id;
      const textId = (): string => {
        const id = streamedId ?? newId();
        streamedId = undefined;
        return id;
      };
      let proposals = 0;
      const kept = state.parts.filter((part) => part.kind !== 'text');
      return [
        ...kept,
        ...ending.pieces.flatMap((piece): ChatPart[] => {
          switch (piece.kind) {
            case 'text': {
              if (piece.text === '') {
                return [];
              }
              return [{ kind: 'text', id: textId(), text: piece.text }];
            }
            case 'proposal': {
              const proposal = proposals;
              proposals += 1;
              return [{ kind: 'proposal', id: newId(), proposal, note: piece.proposal }];
            }
            case 'dropped-proposal': {
              return [{ kind: 'dropped-proposal', id: newId(), reason: piece.reason }];
            }
          }
        }),
      ];
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
