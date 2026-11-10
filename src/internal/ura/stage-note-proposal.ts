import type { Result } from '#x/result/result.ts';

import { createUraItem } from './create-ura-item.ts';
import type { CommitSha, SessionId, UraDeps, UraItem, UraItemError } from './ura-item.ts';
import type { UraSeverity } from './ura-severities.ts';

/** The parts of a note a chat answer proposed (ADR 0132) staging reads, its label checked by main. */
export interface StageableNoteProposal {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly label: UraSeverity;
  readonly title: string;
  readonly body: string;
}

/** Which answer proposed the note, and where in it. */
export interface NoteProposalSource {
  readonly sessionId: SessionId;
  /** The head the answer was given at, which the note's lines refer to. */
  readonly headSha: CommitSha;
  readonly messageId: string;
  /** 0-based, in the answer's order. */
  readonly proposal: number;
}

export interface NoteProposalStaging {
  readonly deps: UraDeps;
  /** The severity the reviewer picked, instead of the proposed label. */
  readonly severity?: UraSeverity | undefined;
}

/**
 * Turns a note an answer proposed, which the reviewer staged, into an item on its lines with a
 * `chat-answer` origin naming the answer and the proposal. The proposed label is the severity
 * unless the reviewer picked another; the model stages nothing itself.
 */
export function stageNoteProposal(
  proposal: StageableNoteProposal,
  source: NoteProposalSource,
  { deps, severity = proposal.label }: NoteProposalStaging,
): Result<UraItem, UraItemError> {
  return createUraItem(
    {
      sessionId: source.sessionId,
      headSha: source.headSha,
      anchor: {
        kind: 'lines',
        path: proposal.path,
        startLine: proposal.startLine,
        endLine: proposal.endLine,
      },
      severity,
      origin: { kind: 'chat-answer', messageId: source.messageId, proposal: source.proposal },
      title: proposal.title,
      body: proposal.body,
    },
    deps,
  );
}
