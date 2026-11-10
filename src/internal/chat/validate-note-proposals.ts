import type { ChatQuestion } from './chat-question.ts';
import { DiffHunkIndex } from './diff-hunk-index.ts';
import type { AnswerPiece, ProposalDropReason, ProposalRules } from './note-proposal.ts';
import type { ProposalSegment } from './parse-note-proposals.ts';

/**
 * Keeps only proposed notes a reviewer can stage on the diff they're shown (ADR 0132), with the
 * findings' anchor check (ADR 0055): a label main offered, head-side lines of a text file of the
 * diff, narrowed to the hunks they touch. The title is made one line of at most 200 characters; a
 * note with neither title nor body is `malformed`; a repeat of an earlier one on the same lines
 * and title is a `duplicate`; those beyond `maxProposals` are `over-limit`. Each dropped note
 * stays in place as a `dropped-proposal` piece. Text is kept as it is. Pure, in answer order.
 */
export function validateNoteProposals(
  segments: readonly ProposalSegment[],
  input: Pick<ChatQuestion, 'files' | 'worktreePath'>,
  rules: ProposalRules,
): AnswerPiece[] {
  const hunks = new DiffHunkIndex(input);
  const labels = new Set(rules.labels);
  const seen = new Set<string>();
  let kept = 0;
  const dropped = (reason: ProposalDropReason): AnswerPiece => {
    return { kind: 'dropped-proposal', reason };
  };
  return segments.map((segment): AnswerPiece => {
    if (segment.kind === 'text') {
      return segment;
    }
    if (segment.kind === 'malformed') {
      return dropped('malformed');
    }
    if (!labels.has(segment.label)) {
      return dropped('unknown-label');
    }
    const title = segment.title.replaceAll(whitespace, ' ').trim().slice(0, maxTitleLength).trim();
    if (title === '' && segment.body === '') {
      return dropped('malformed');
    }
    const anchor = hunks.anchor(segment.lines);
    if (anchor.kind !== 'in-diff') {
      return dropped(anchor.kind);
    }
    const key = [anchor.path, anchor.startLine, anchor.endLine, title.toLowerCase()].join('\0');
    if (seen.has(key)) {
      return dropped('duplicate');
    }
    seen.add(key);
    if (kept >= rules.maxProposals) {
      return dropped('over-limit');
    }
    kept += 1;
    const { path, startLine, endLine } = anchor;
    return {
      kind: 'proposal',
      proposal: { path, startLine, endLine, label: segment.label, title, body: segment.body },
    };
  });
}

const whitespace = /\s+/gu;
const maxTitleLength = 200;
