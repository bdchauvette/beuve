import type { ProposalDropReasonView } from '#contract/ipc-contract.ts';

const reasons: Readonly<Record<ProposalDropReasonView, string>> = {
  malformed: 'its block did not parse or said nothing',
  'unknown-label': 'its label is not a note label',
  'unknown-file': 'its file is not in this diff',
  'outside-diff': 'its lines are outside the diff’s hunks',
  duplicate: 'it repeats an earlier note',
  'over-limit': 'the answer proposed too many',
};

/** The line a transcript shows where an answer proposed a note main dropped (ADR 0132). Pure. */
export function describeDroppedProposal(reason: ProposalDropReasonView): string {
  return `A proposed note was left out: ${reasons[reason]}.`;
}
