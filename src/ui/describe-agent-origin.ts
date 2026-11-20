import type { UraOriginView } from '#contract/ipc-contract.ts';

/** Where an agent's note came from, for its ✨ card (ADR 0154). */
export interface AgentOriginLabels {
  /** "From a /review finding, 82% confidence", "Proposed in a chat answer", … */
  readonly source: string;
  /** What Show in chat finds: the answer, and the finding or proposal in it. */
  readonly messageId: string;
  readonly finding?: number;
  readonly proposal?: number;
}

/** How an agent's note says where it came from; `undefined` for a note you wrote. Pure. */
export function describeAgentOrigin(origin: UraOriginView): AgentOriginLabels | undefined {
  if (origin.kind !== 'chat-answer') {
    return undefined;
  }
  const { messageId, finding, proposal, confidence } = origin;
  if (finding !== undefined) {
    let source = 'From a /review finding';
    if (confidence !== undefined) {
      source += `, ${String(Math.round(confidence * 100))}% confidence`;
    }
    return { source, messageId, finding };
  }
  if (proposal !== undefined) {
    return { source: 'Proposed in a chat answer', messageId, proposal };
  }
  return { source: 'Staged from a chat answer', messageId };
}
